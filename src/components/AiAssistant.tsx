'use client';

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { 
  X, 
  Send, 
  Loader2, 
  Mic, 
  MicOff, 
  Volume2, 
  VolumeX, 
  Square,
  RotateCcw,
  Headphones,
  Sparkles,
  CheckCircle2
} from "lucide-react";
import { useUser } from "./UserContext";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  spoken_text?: string;
  created_at: string;
  action?: string;
  target?: string;
}

function cleanTextForSpeech(text: string): string {
  if (!text) return "";
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1") // Bold
    .replace(/`(.*?)`/g, "$1") // Inline code
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1") // Links
    .replace(/[•\-\*]\s+/g, "") // Bullets
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "") // Emojis
    .replace(/[\u2600-\u27BF]/g, "") // Dingbats / symbols
    .replace(/\$([0-9,]+(?:\.[0-9]{2})?)/g, "$1 dollars") // $1,240.00 -> 1,240 dollars
    .replace(/(\d+)%/g, "$1 percent") // 98% -> 98 percent
    .replace(/PP-D-(\d+)/gi, "dispute $1") // PP-D-99214 -> dispute 99214
    .replace(/[#_~`]/g, "") // Markdown formatting
    .replace(/\(([^\)]+)\)/g, " $1 ") // Expand parentheses to words
    .replace(/<48h/gi, "under 48 hours")
    .replace(/\bINR\b/g, "Item Not Received")
    .replace(/\bSNAD\b/g, "Significantly Not As Described")
    .replace(/\bPOD\b/g, "Proof of Delivery")
    .replace(/\bTxID\b/g, "Transaction ID")
    .replace(/:\s+/g, ". ") // Colons to period pauses
    .replace(/\n\n+/g, ". ")
    .replace(/\n/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

export default function AiAssistant() {
  const router = useRouter();
  const { activeUser } = useUser();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeAction, setActiveAction] = useState<{ label: string; status: "running" | "done" } | null>(null);

  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [voiceAudioEnabled, setVoiceAudioEnabled] = useState(true);
  const [currentlySpeakingId, setCurrentlySpeakingId] = useState<string | null>(null);
  const [currentSpokenText, setCurrentSpokenText] = useState<string>("");
  const [activeVoiceName, setActiveVoiceName] = useState<string>("");

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef<string>("");
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pinnedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const sendMessageRef = useRef<(text?: string) => Promise<void>>(async () => {});
  const startListeningRef = useRef<() => void>(() => {});

  const selectBestVoice = useCallback((): SpeechSynthesisVoice | null => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return null;

    // Check if we previously pinned a natural voice that exists in the browser
    const savedURI = localStorage.getItem("ai_pinned_voice_uri");
    if (savedURI) {
      if (!savedURI.toLowerCase().includes("espeak")) {
        const match = voices.find(v => v.voiceURI === savedURI);
        if (match) return match;
      } else {
        localStorage.removeItem("ai_pinned_voice_uri");
      }
    }

    // High quality natural voice matching hierarchy (strictly avoiding robotic espeak)
    const matchers = [
      (v: SpeechSynthesisVoice) => v.name.includes("Google UK English Female") && v.lang.startsWith("en"),
      (v: SpeechSynthesisVoice) => v.name.includes("Google US English") && v.lang.startsWith("en"),
      (v: SpeechSynthesisVoice) => (v.name.includes("Jenny") || v.name.includes("Aria")) && v.lang.startsWith("en"),
      (v: SpeechSynthesisVoice) => v.name.includes("Natural") && v.lang.startsWith("en"),
      (v: SpeechSynthesisVoice) => (v.name.includes("Samantha") || v.name.includes("Victoria") || v.name.includes("Karen")) && v.lang.startsWith("en"),
      (v: SpeechSynthesisVoice) => v.lang === "en-US" && !v.name.toLowerCase().includes("espeak") && !v.voiceURI.toLowerCase().includes("espeak"),
      (v: SpeechSynthesisVoice) => v.lang.startsWith("en") && !v.name.toLowerCase().includes("espeak") && !v.voiceURI.toLowerCase().includes("espeak"),
    ];

    for (const matcher of matchers) {
      const candidate = voices.find(matcher);
      if (candidate) {
        try { localStorage.setItem("ai_pinned_voice_uri", candidate.voiceURI); } catch {}
        return candidate;
      }
    }

    const nonEspeak = voices.find(v => !v.name.toLowerCase().includes("espeak") && !v.voiceURI.toLowerCase().includes("espeak"));
    if (nonEspeak) return nonEspeak;

    return voices[0];
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const hasSpeechRecognition = "webkitSpeechRecognition" in window || "SpeechRecognition" in window;
      setSpeechSupported(hasSpeechRecognition);

      const savedAudio = localStorage.getItem("ai_voice_audio_enabled");
      if (savedAudio !== null) {
        setVoiceAudioEnabled(savedAudio === "true");
      } else {
        setVoiceAudioEnabled(true);
      }

      if ("speechSynthesis" in window) {
        const initVoice = () => {
          const voices = window.speechSynthesis.getVoices();
          if (!voices || voices.length === 0) return;

          // If we already pinned a natural voice, keep that exact voice (do not switch mid-session)
          if (pinnedVoiceRef.current) {
            const isEspeak = pinnedVoiceRef.current.name.toLowerCase().includes("espeak") || 
                             pinnedVoiceRef.current.voiceURI.toLowerCase().includes("espeak");
            if (!isEspeak) {
              const liveMatch = voices.find(v => v.voiceURI === pinnedVoiceRef.current?.voiceURI);
              if (liveMatch) {
                pinnedVoiceRef.current = liveMatch;
                setActiveVoiceName(liveMatch.name);
                return;
              }
            }
          }

          const best = selectBestVoice();
          if (best) {
            pinnedVoiceRef.current = best;
            setActiveVoiceName(best.name);
          }
        };

        initVoice();
        window.speechSynthesis.onvoiceschanged = initVoice;

        return () => {
          if (window.speechSynthesis) {
            window.speechSynthesis.onvoiceschanged = null;
            window.speechSynthesis.cancel();
          }
        };
      }
    }
  }, [selectBestVoice]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  const speakText = useCallback((text: string, messageId: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    window.speechSynthesis.cancel();
    setCurrentlySpeakingId(messageId);
    setCurrentSpokenText(text);

    const clean = cleanTextForSpeech(text);
    if (!clean) {
      setCurrentlySpeakingId(null);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 1.0;
    utterance.pitch = 1.02;

    if (!pinnedVoiceRef.current) {
      pinnedVoiceRef.current = selectBestVoice();
    }
    if (pinnedVoiceRef.current) {
      utterance.voice = pinnedVoiceRef.current;
      utterance.lang = pinnedVoiceRef.current.lang || "en-US";
      setActiveVoiceName(pinnedVoiceRef.current.name);
    }

    activeUtteranceRef.current = utterance;

    utterance.onend = () => {
      setCurrentlySpeakingId(null);
      activeUtteranceRef.current = null;

      // Humanized response intake: If Ava asked a question or offered suggestions, wait and auto-listen for the merchant's answer!
      const isQuestion = clean.includes("?") || /\b(would you|should I|what do you|tell me|confirm|how can I|can I help)\b/i.test(clean);
      if (isQuestion && typeof window !== "undefined" && ("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
        setTimeout(() => {
          if (startListeningRef.current) {
            startListeningRef.current();
          }
        }, 450);
      }
    };

    utterance.onerror = () => {
      setCurrentlySpeakingId(null);
      activeUtteranceRef.current = null;
    };

    window.speechSynthesis.speak(utterance);
  }, [selectBestVoice]);

  const stopSpeaking = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      setCurrentlySpeakingId(null);
      activeUtteranceRef.current = null;
    }
  };

  const toggleVoiceAudio = () => {
    const next = !voiceAudioEnabled;
    setVoiceAudioEnabled(next);
    localStorage.setItem("ai_voice_audio_enabled", String(next));
    if (!next) {
      stopSpeaking();
    }
  };

  const startListening = useCallback(() => {
    if (typeof window === "undefined" || isListening) return;

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      setCurrentlySpeakingId(null);
      activeUtteranceRef.current = null;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onstart = () => {
        setIsListening(true);
        transcriptRef.current = "";
      };

      recognition.onresult = (event: any) => {
        let fullTranscript = "";
        for (let i = 0; i < event.results.length; i++) {
          fullTranscript += event.results[i][0].transcript;
        }
        transcriptRef.current = fullTranscript;
        setInput(fullTranscript);
      };

      recognition.onerror = (event: any) => {
        if (event.error !== "no-speech") {
          console.error("Speech recognition error:", event.error);
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
        const text = transcriptRef.current?.trim() || inputRef.current?.value?.trim() || "";
        if (text.length > 0) {
          sendMessageRef.current(text);
          transcriptRef.current = "";
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error("Failed to start speech recognition:", err);
      setIsListening(false);
    }
  }, [isListening]);

  startListeningRef.current = startListening;

  const toggleListening = () => {
    if (typeof window === "undefined") return;

    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      return;
    }

    startListening();
  };

  const executePlatformAction = async (action?: string, target?: string) => {
    if (!action) return;

    if (action === "RESOLVE_DISPUTE") {
      setActiveAction({ label: "Opening Case...", status: "running" });
      setTimeout(() => {
        setActiveAction({ label: "Case Opened", status: "done" });
        if (target) {
          router.push(target);
        }
      }, 1000);
      return;
    }

    if (action === "CREATE_SALE") {
      setActiveAction({ label: "Capturing Demo Sale & Vaulting Evidence...", status: "running" });
      try {
        const res = await fetch("/api/storefront/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            buyer_name: "Jordan Miller",
            buyer_email: "jordan.miller@example.com",
            shipping_address: "742 Evergreen Terrace, Springfield, OR 97477",
            items: [
              {
                name: "DJI Mavic 3 Pro Cine Drone",
                quantity: 1,
                unit_price_cents: 219900,
                sku: "DJI-M3P-CINE",
              },
            ],
            carrier: "USPS",
          }),
        });
        if (!res.ok) throw new Error(`checkout failed (${res.status})`);
        setActiveAction({ label: "Sale Captured & Hashed (SHA-256)", status: "done" });
        setTimeout(() => router.push("/storefront"), 1000);
      } catch {
        setActiveAction(null);
      }
      return;
    }

    if (action === "RUN_ATTACKS") {
      setActiveAction({ label: "Running Trust Lab Penetration Suite...", status: "running" });
      try {
        const res = await fetch("/api/trust-lab/run", { method: "POST" });
        if (!res.ok) throw new Error(`trust lab failed (${res.status})`);
        const data: { results?: { blocked: boolean }[] } = await res.json();
        const results = data.results ?? [];
        const blocked = results.filter((r) => r.blocked).length;
        setActiveAction({ label: `${blocked} of ${results.length} Attacks Blocked`, status: "done" });
        setTimeout(() => router.push("/trust-lab"), 1200);
      } catch {
        setActiveAction(null);
      }
      return;
    }

    if (action === "SIMULATE_DISPUTE") {
      setActiveAction({ label: "Simulating Incoming PayPal Dispute...", status: "running" });
      try {
        const res = await fetch("/api/disputes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
            amount_cents: 24900,
            hours_until_deadline: 48,
            buyer_message: "Buyer opened inquiry for item not received.",
          }),
        });
        if (!res.ok) throw new Error(`dispute simulation failed (${res.status})`);
        setActiveAction({ label: "Dispute Ingested & Vaulted with SHA-256", status: "done" });
        setTimeout(() => router.push("/"), 1200);
      } catch {
        setActiveAction(null);
      }
      return;
    }

    if (action === "SEED_DEMO") {
      if (!window.confirm("Reset the demo? This erases every dispute, order and audit record in this workspace and reloads the sample data.")) {
        return;
      }
      setActiveAction({ label: "Seeding Demo Database...", status: "running" });
      try {
        const res = await fetch("/api/demo/seed", { method: "POST" });
        if (!res.ok) throw new Error(`reset failed (${res.status})`);
        setActiveAction({ label: "Database Synchronized", status: "done" });
      } catch {
        setActiveAction(null);
      }
      return;
    }

    if (action === "NAVIGATE" && target) {
      setActiveAction({ label: `Navigating to ${target}...`, status: "done" });
      setTimeout(() => router.push(target), 800);
    }
  };

  const sendMessage = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || loading || !activeUser) return;
    setInput("");
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }

    const userMsg: Message = {
      id: "tmp_" + Date.now(),
      role: "user",
      content: msg,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch("/api/ai-assistant", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          user_id: activeUser.id,
        }),
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (data.message) {
        const assistantMsg: Message = {
          ...data.message,
          action: data.action,
          target: data.target,
        };
        setMessages((prev) => [...prev, assistantMsg]);
        const spoken = data.message.spoken_text || data.message.content;
        setCurrentSpokenText(spoken);

        if (data.action) {
          executePlatformAction(data.action, data.target);
        }

        if (voiceAudioEnabled) {
          speakText(spoken, data.message.id);
        }

        setTimeout(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = 0;
          }
        }, 50);
      }
    } catch (_) {
      clearTimeout(timeoutId);
      const fallback = "I am actively monitoring your store. How can I help you resolve this?";
      setMessages((prev) => [...prev, {
        id: "err_" + Date.now(),
        role: "assistant",
        content: fallback,
        created_at: new Date().toISOString(),
      }]);
      setCurrentSpokenText(fallback);
    } finally {
      setLoading(false);
    }
  };

  sendMessageRef.current = sendMessage;

  const getSuggestionsForLatestMessage = () => {
    const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
    if (!lastAssistantMsg) {
      return [
        "What is our active dispute risk?",
        "Explain § 11.3 Seller Protection",
        "Check Evidence Vault proofs"
      ];
    }
    const text = lastAssistantMsg.content.toLowerCase();
    if (text.includes("dispute") || text.includes("pp-d-") || text.includes("rebuttal")) {
      return [
        "Yes, submit defense to PayPal",
        "Show carrier tracking proof",
        "What is the submission deadline?"
      ];
    }
    if (text.includes("vault") || text.includes("evidence") || text.includes("hash")) {
      return [
        "Is tracking verified?",
        "Check § 11.3(b) signature threshold",
        "View order invoice details"
      ];
    }
    if (text.includes("attack") || text.includes("security") || text.includes("threat")) {
      return [
        "Run full Trust Lab suite",
        "Explain prompt injection defense",
        "Show cryptographic audit log"
      ];
    }
    return [
      "Show active disputes",
      "Check Seller Protection rules",
      "Simulate storefront checkout"
    ];
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!activeUser) return null;

  const isSpeaking = Boolean(currentlySpeakingId);
  const greeting = currentSpokenText || `Hello ${activeUser.name || "there"}! I am Ava. Tell me what you need, or tap the microphone to talk with me.`;

  return (
    <>
      {!open && (
        <div 
          className="fixed-floating-assistant group select-none fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-[9999]"
        >
          {/* Ambient Living AI Glow Blur Halo underneath & radiating outward */}
          <div className="absolute -inset-2 rounded-full bg-gradient-to-r from-[#0070BA] via-indigo-500 to-cyan-400 opacity-75 blur-xl group-hover:opacity-100 group-hover:blur-2xl animate-pulse pointer-events-none transition-all duration-700" />
          <div className="absolute -inset-0.5 rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-400 opacity-60 blur-md pointer-events-none" />

          {/* Frosted Glassmorphism AI Button */}
          <button
            onClick={() => {
              setOpen(true);
              if (voiceAudioEnabled && !currentlySpeakingId) {
                speakText(greeting, "welcome");
              }
            }}
            className="relative flex items-center gap-2 px-4 py-2.5 rounded-full bg-gradient-to-r from-[#001C48]/95 via-[#003087]/90 to-[#0070BA]/90 backdrop-blur-xl border border-white/30 shadow-[0_8px_24px_rgba(0,48,135,0.4),inset_0_1px_1px_rgba(255,255,255,0.4)] text-white hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer ring-2 ring-white/60"
            title="Open Ava AI Dispute Partner"
          >
            <Sparkles className="w-4 h-4 text-cyan-300 animate-pulse shrink-0" />
            <span className="text-xs font-black tracking-wide text-white">Ava AI</span>

            {/* Specular Top Shine Line */}
            <div className="absolute inset-x-3 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/50 to-transparent pointer-events-none" />
          </button>
        </div>
      )}

      {open && (
        <div
          className="fixed-floating-assistant select-none fixed bottom-3 right-3 sm:bottom-6 sm:right-6 z-[9999] max-w-[calc(100vw-24px)]"
        >
          {/* Ambient Ethereal Glow Blur around the open AI card */}
          <div className="absolute -inset-3 rounded-[36px] bg-gradient-to-tr from-[#0070BA]/40 via-indigo-500/30 to-cyan-400/35 blur-2xl pointer-events-none -z-10 animate-pulse-soft" />

          <div
            className="card-3d-reflection w-[calc(100vw-24px)] sm:w-[380px] max-w-[380px] max-h-[calc(100dvh-64px)] sm:max-h-[min(540px,calc(100vh-100px))] h-auto rounded-[24px] sm:rounded-[28px] flex flex-col overflow-hidden shadow-2xl transition-all duration-300 animate-in slide-in-from-bottom-4 zoom-in-95 origin-bottom-right relative"
          >
            {/* ── Sleek Gradient Header with AI Sparkles ── */}
            <div className="bg-gradient-to-r from-[#001C48] via-[#003087] to-[#0070BA] px-4 py-3 flex items-center justify-between shrink-0 text-white select-none">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-400/30 to-blue-400/20 flex items-center justify-center shrink-0 border border-cyan-300/40 shadow-xs">
                  <Sparkles className="w-4 h-4 text-cyan-200 fill-cyan-300/30 animate-pulse" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-white font-black text-xs leading-none">Ava <span className="text-cyan-300">AI</span></h4>
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_6px_#22d3ee]" />
                    <span className="text-[9px] font-black uppercase tracking-wider text-cyan-200 bg-cyan-500/20 px-1.5 py-0.5 rounded border border-cyan-400/30">
                      Ava v2.5
                    </span>
                    {activeVoiceName && (
                      <span 
                        className="text-[9px] text-blue-200 font-mono bg-blue-950/70 px-1.5 py-0.5 rounded border border-blue-600/50 truncate max-w-[80px]" 
                        title={`Active Voice: ${activeVoiceName}`}
                      >
                        {activeVoiceName.replace(/Google /i, "").replace(/English /i, "").replace(/\(.*?\)/g, "").trim()}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-cyan-200/90 font-medium leading-none mt-1 truncate flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5 text-amber-300" />
                    PayPal AI Dispute Partner • Autonomous Defense
                  </p>
                </div>
              </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={toggleVoiceAudio}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  voiceAudioEnabled 
                    ? "text-emerald-300 hover:bg-white/10" 
                    : "text-white/40 hover:bg-white/10"
                }`}
                title={voiceAudioEnabled ? "Voice: ON (Click to Mute)" : "Voice: Muted (Click to Unmute)"}
              >
                {voiceAudioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>

              <button
                onClick={() => { stopSpeaking(); setOpen(false); }}
                className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="Close Assistant"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* ── Main Chat & Voice Interaction Body ── */}
          <div className="p-3.5 sm:p-4 flex flex-col items-center justify-between space-y-3 bg-gradient-to-b from-slate-50/60 to-white overflow-y-auto min-h-0 flex-1">
            
            {activeAction && (
              <div className="w-full bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-xl flex items-center justify-between text-xs text-[#003087] animate-in fade-in shrink-0">
                <span className="flex items-center gap-1.5 text-[11px] font-bold">
                  {activeAction.status === "running" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#003087]" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
                  )}
                  {activeAction.label}
                </span>
              </div>
            )}

            {/* Voice Radar Orb Visualizer */}
            <div className="py-1 flex flex-col items-center justify-center text-center select-none relative shrink-0">
              <div className="relative flex items-center justify-center">
                
                <div className={`absolute w-20 h-20 rounded-full border border-blue-400/20 transition-all duration-500 ${
                  isSpeaking || isListening ? "scale-110 opacity-100 animate-ping" : "scale-90 opacity-0"
                }`} />

                <div className={`absolute w-16 h-16 rounded-full bg-blue-500/10 transition-all duration-300 ${
                  isSpeaking ? "scale-105 animate-pulse" : isListening ? "scale-110 bg-rose-500/10" : "scale-95"
                }`} />

                <button
                  type="button"
                  onClick={toggleListening}
                  className={`w-12 h-12 rounded-full flex items-center justify-center relative shadow-md transition-all duration-300 cursor-pointer ${
                    isListening
                      ? "bg-gradient-to-tr from-rose-600 to-amber-500 ring-4 ring-rose-300 scale-105"
                      : isSpeaking
                      ? "bg-gradient-to-tr from-[#001C48] via-[#003087] to-[#0070BA] ring-4 ring-blue-400/40 animate-orb-pulse scale-105"
                      : "bg-gradient-to-tr from-[#001433] via-[#001C48] to-[#003087] ring-4 ring-slate-200/80 hover:ring-blue-400/50 hover:scale-105"
                  }`}
                  title={isListening ? "Listening... Tap to send" : "Tap to speak with Ava"}
                >
                  <div className="absolute inset-0 rounded-full bg-gradient-to-t from-transparent via-white/10 to-white/25 pointer-events-none" />

                  {isSpeaking ? (
                    <div className="flex items-center gap-0.5 h-4 z-10">
                      <span className="w-1 bg-blue-300 rounded-full" style={{ animation: "wave-bounce 0.8s ease-in-out infinite 0ms" }} />
                      <span className="w-1 bg-white rounded-full" style={{ animation: "wave-bounce 0.9s ease-in-out infinite 150ms" }} />
                      <span className="w-1 bg-blue-200 rounded-full" style={{ animation: "wave-bounce 0.7s ease-in-out infinite 300ms" }} />
                      <span className="w-1 bg-white rounded-full" style={{ animation: "wave-bounce 0.85s ease-in-out infinite 100ms" }} />
                    </div>
                  ) : isListening ? (
                    <Mic className="w-4 h-4 text-white animate-pulse z-10" />
                  ) : loading ? (
                    <Loader2 className="w-4 h-4 text-blue-300 animate-spin z-10" />
                  ) : (
                    <Sparkles className="w-4 h-4 text-cyan-300 animate-pulse z-10" />
                  )}
                </button>
              </div>

              <p className="mt-1.5 text-xs font-bold text-slate-700 tracking-tight">
                {isListening ? (
                  <span className="text-rose-600 font-extrabold flex items-center justify-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                    Listening to your voice...
                  </span>
                ) : isSpeaking ? (
                  <span className="text-[#003087] flex items-center justify-center gap-1 font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Ava speaking
                  </span>
                ) : loading ? (
                  <span className="text-slate-500">Retrieving policy &amp; telemetry...</span>
                ) : (
                  <span className="text-slate-500">Tap microphone to speak</span>
                )}
              </p>
            </div>

            {/* Conversation Feed / Spoken Response Area */}
            <div 
              ref={scrollContainerRef} 
              className="w-full bg-white rounded-2xl p-3 border border-slate-200/80 shadow-xs max-h-36 sm:max-h-48 overflow-y-auto space-y-2 transition-all flex-1 min-h-[80px] custom-scrollbar"
            >
              {isListening ? (
                <div className="space-y-1 animate-in fade-in">
                  <span className="text-[10px] font-bold text-rose-600 uppercase tracking-wider flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                    Live Audio Transcription:
                  </span>
                  <p className="text-xs text-slate-800 leading-relaxed font-medium italic">
                    {input ? `“${input}”` : "Listening... speak now to resolve a claim or query store data."}
                  </p>
                </div>
              ) : messages.length > 0 ? (
                <div className="space-y-2">
                  {messages.slice(-3).map((msg) => (
                    <div 
                      key={msg.id}
                      className={`text-xs p-2.5 rounded-2xl leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-blue-50 text-[#003087] font-semibold border border-blue-100 ml-6 text-right'
                          : 'bg-slate-50 text-slate-800 font-medium border border-slate-200/70 mr-4 whitespace-pre-line'
                      }`}
                    >
                      {msg.content}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-800 leading-relaxed font-medium whitespace-pre-line">
                  {greeting}
                </p>
              )}

              {isSpeaking && (
                <div className="pt-1.5 flex items-center justify-end gap-2 border-t border-slate-100">
                  <button
                    onClick={stopSpeaking}
                    className="flex items-center gap-1 text-[11px] font-bold text-rose-600 hover:text-rose-700 cursor-pointer"
                  >
                    <Square className="w-3 h-3 fill-current" />
                    <span>Stop</span>
                  </button>
                  <button
                    onClick={() => speakText(greeting, "replay")}
                    className="flex items-center gap-1 text-[11px] font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Replay</span>
                  </button>
                </div>
              )}
            </div>

            {/* Dynamic Human-Assistance Suggested Answers */}
            <div className="w-full flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 shrink-0">
              {getSuggestionsForLatestMessage().map((chip, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => sendMessage(chip)}
                  disabled={loading}
                  className="px-2.5 py-1 rounded-full bg-blue-50/80 hover:bg-blue-100/90 hover:text-[#003087] border border-blue-200/80 text-[10px] font-bold text-slate-800 whitespace-nowrap btn-press transition-all cursor-pointer flex items-center gap-1 shadow-2xs"
                >
                  <span className="text-[#0070BA]">💬</span>
                  <span>{chip}</span>
                </button>
              ))}
            </div>

            {/* Quick Merchant Operations Prompt Pills */}
            <div className="w-full flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 shrink-0">
              <button
                type="button"
                onClick={() => sendMessage("Show summary of active disputes and at-risk capital")}
                className="px-2.5 py-1 rounded-full bg-amber-50 hover:bg-amber-100 border border-amber-200 text-[10px] font-bold text-amber-900 whitespace-nowrap btn-press transition-all cursor-pointer flex items-center gap-1"
              >
                <span>📊 Dispute Overview</span>
              </button>
              <button
                type="button"
                onClick={() => sendMessage("Retrieve PayPal Seller Protection rules for Case PP-D-99214")}
                className="px-2.5 py-1 rounded-full bg-blue-50 hover:bg-blue-100 border border-blue-200 text-[10px] font-bold text-[#003087] whitespace-nowrap btn-press transition-all cursor-pointer flex items-center gap-1"
              >
                <span>🔍 § 11.3 Rules</span>
              </button>
              <button
                type="button"
                onClick={() => sendMessage("Show evidence vault verification for $1,240 drone")}
                className="px-2.5 py-1 rounded-full bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-[10px] font-bold text-indigo-900 whitespace-nowrap btn-press transition-all cursor-pointer flex items-center gap-1"
              >
                <span>🛡️ Vault Proof</span>
              </button>
              <button
                type="button"
                onClick={() => sendMessage("Run Trust Lab penetration attacks")}
                className="px-2.5 py-1 rounded-full bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-[10px] font-bold text-emerald-900 whitespace-nowrap btn-press transition-all cursor-pointer flex items-center gap-1"
              >
                <span>⚡ Test Security</span>
              </button>
            </div>

            {/* Bottom Input Field */}
            <div className="w-full pt-1 shrink-0">
              <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 border border-slate-200">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isListening ? "Listening to your voice..." : "Speak or type command..."}
                  rows={1}
                  className="flex-1 resize-none bg-transparent px-2.5 py-1 text-xs text-slate-800 placeholder-slate-400 focus:outline-none max-h-16 overflow-y-auto custom-scrollbar"
                  disabled={loading}
                />

                {speechSupported && (
                  <button
                    type="button"
                    onClick={toggleListening}
                    disabled={loading}
                    className={`p-1.5 rounded-lg transition-all shrink-0 cursor-pointer ${
                      isListening
                        ? "bg-rose-600 text-white animate-pulse"
                        : "text-slate-500 hover:text-slate-900 hover:bg-white"
                    }`}
                    title={isListening ? "Stop listening" : "Speak into microphone"}
                  >
                    {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => sendMessage()}
                  disabled={!input.trim() || loading}
                  className="w-7 h-7 rounded-lg bg-[#003087] hover:bg-[#001C48] text-white flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0 cursor-pointer"
                  title="Send"
                >
                  {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>
      )}
    </>
  );
}
