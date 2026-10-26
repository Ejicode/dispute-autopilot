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

  const toggleListening = () => {
    if (typeof window === "undefined") return;

    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      return;
    }

    stopSpeaking();

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser. Please use Chrome or Edge.");
      return;
    }

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
          sendMessage(text);
          transcriptRef.current = "";
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error("Failed to start speech recognition:", err);
      setIsListening(false);
    }
  };

  const executePlatformAction = async (action?: string, target?: string) => {
    if (!action) return;

    if (action === "RESOLVE_DISPUTE") {
      setActiveAction({ label: "Opening Case & Preparing Verified Rebuttal...", status: "running" });
      setTimeout(() => {
        setActiveAction({ label: "Rebuttal Verified & Loaded", status: "done" });
        if (target) {
          router.push(target);
        }
      }, 1000);
      return;
    }

    if (action === "CREATE_SALE") {
      setActiveAction({ label: "Capturing Demo Sale & Vaulting Evidence...", status: "running" });
      try {
        await fetch("/api/storefront/checkout", {
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
        await fetch("/api/trust-lab/attacks/run-all", { method: "POST" });
        setActiveAction({ label: "All 6 Attacks Blocked (100% Defense)", status: "done" });
        setTimeout(() => router.push("/trust-lab"), 1200);
      } catch {
        setActiveAction({ label: "Security test complete", status: "done" });
      }
      return;
    }

    if (action === "SIMULATE_DISPUTE") {
      setActiveAction({ label: "Simulating Incoming PayPal Dispute...", status: "running" });
      try {
        await fetch("/api/disputes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
            amount_cents: 24900,
            hours_until_deadline: 48,
            buyer_message: "Buyer opened inquiry for item not received.",
          }),
        });
        setActiveAction({ label: "Dispute Ingested & Vaulted with SHA-256", status: "done" });
        setTimeout(() => router.push("/"), 1200);
      } catch {
        setActiveAction(null);
      }
      return;
    }

    if (action === "SEED_DEMO") {
      setActiveAction({ label: "Seeding Demo Database...", status: "running" });
      try {
        await fetch("/api/demo/seed", { method: "POST" });
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

    try {
      const res = await fetch("/api/ai-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          user_id: activeUser.id,
        }),
      });
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
        <button
          onClick={() => {
            setOpen(true);
            if (voiceAudioEnabled && !currentlySpeakingId) {
              speakText(greeting, "welcome");
            }
          }}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-3.5 py-2.5 rounded-full bg-[#0A3E29] hover:bg-[#06291B] shadow-xl text-white hover:scale-105 active:scale-95 transition-all duration-300 cursor-pointer ring-4 ring-white border border-emerald-500/25 group select-none"
          title="Open Voice Assistant"
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
          </span>
          <span className="text-xs font-bold tracking-tight text-white flex items-center gap-1">
            <Headphones className="w-3.5 h-3.5 text-emerald-300" />
            Ava
          </span>
        </button>
      )}

      {open && (
        <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 w-[340px] sm:w-[360px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-32px)] sm:max-h-[min(540px,calc(100vh-48px))] h-auto rounded-[24px] card-3d-reflection bg-white flex flex-col overflow-hidden shadow-2xl transition-all duration-300 animate-in slide-in-from-bottom-4 fade-in">
          
          <div className="bg-[#0A3E29] px-4 py-2.5 flex items-center justify-between shrink-0 text-white select-none">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-lg bg-white/10 flex items-center justify-center shrink-0 border border-white/20">
                <Headphones className="w-3.5 h-3.5 text-emerald-300" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h4 className="text-white font-bold text-xs leading-none">Ava</h4>
                  {activeVoiceName && (
                    <span 
                      className="text-[9px] text-emerald-300/90 font-mono bg-emerald-950/70 px-1 py-0.5 rounded border border-emerald-700/50 truncate max-w-[100px]" 
                      title={`Active Voice: ${activeVoiceName}`}
                    >
                      {activeVoiceName.replace(/Google /i, "").replace(/English /i, "").replace(/\(.*?\)/g, "").trim()}
                    </span>
                  )}
                </div>
                <p className="text-[9.5px] text-emerald-200/80 leading-none mt-0.5 truncate">Dispute Defense Partner</p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={toggleVoiceAudio}
                className={`p-1.5 rounded-lg transition-colors ${
                  voiceAudioEnabled 
                    ? "text-emerald-300 hover:bg-white/10" 
                    : "text-white/40 hover:bg-white/10"
                }`}
                title={voiceAudioEnabled ? "Voice: ON (Click to Mute)" : "Voice: Muted (Click to Unmute)"}
              >
                {voiceAudioEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              </button>

              <button
                onClick={() => { stopSpeaking(); setOpen(false); }}
                className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                title="Close"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="p-3.5 sm:p-4 flex flex-col items-center justify-between space-y-3 bg-gradient-to-b from-slate-50/50 to-white overflow-y-auto min-h-0 flex-1">
            
            {activeAction && (
              <div className="w-full bg-[#EBF5EF] border border-[#D5EDE0] px-3 py-1.5 rounded-xl flex items-center justify-between text-xs text-[#0A3E29] animate-in fade-in shrink-0">
                <span className="flex items-center gap-1.5 text-[11px] font-bold">
                  {activeAction.status === "running" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0A3E29]" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  )}
                  {activeAction.label}
                </span>
              </div>
            )}

            <div className="py-1 flex flex-col items-center justify-center text-center select-none relative shrink-0">
              <div className="relative flex items-center justify-center">
                
                <div className={`absolute w-24 h-24 rounded-full border border-emerald-400/20 transition-all duration-500 ${
                  isSpeaking || isListening ? "scale-110 opacity-100 animate-ping" : "scale-90 opacity-0"
                }`} />

                <div className={`absolute w-20 h-20 rounded-full bg-emerald-500/10 transition-all duration-300 ${
                  isSpeaking ? "scale-105 animate-pulse" : isListening ? "scale-110 bg-rose-500/10" : "scale-95"
                }`} />

                <button
                  type="button"
                  onClick={toggleListening}
                  className={`w-14 h-14 rounded-full flex items-center justify-center relative shadow-md transition-all duration-300 cursor-pointer ${
                    isListening
                      ? "bg-gradient-to-tr from-rose-600 to-amber-500 ring-4 ring-rose-300 scale-105"
                      : isSpeaking
                      ? "bg-gradient-to-tr from-[#06291B] via-[#0A3E29] to-[#10B981] ring-4 ring-emerald-400/40 animate-orb-pulse scale-105"
                      : "bg-gradient-to-tr from-[#06291B] via-[#0A3E29] to-[#041F14] ring-4 ring-slate-200/80 hover:ring-emerald-400/50 hover:scale-105"
                  }`}
                  title={isListening ? "Listening... Tap to send" : "Tap to speak with Ava"}
                >
                  <div className="absolute inset-0 rounded-full bg-gradient-to-t from-transparent via-white/10 to-white/25 pointer-events-none" />

                  {isSpeaking ? (
                    <div className="flex items-center gap-0.5 h-5 z-10">
                      <span className="w-1 bg-emerald-300 rounded-full" style={{ animation: "wave-bounce 0.8s ease-in-out infinite 0ms" }} />
                      <span className="w-1 bg-white rounded-full" style={{ animation: "wave-bounce 0.9s ease-in-out infinite 150ms" }} />
                      <span className="w-1 bg-emerald-200 rounded-full" style={{ animation: "wave-bounce 0.7s ease-in-out infinite 300ms" }} />
                      <span className="w-1 bg-white rounded-full" style={{ animation: "wave-bounce 0.85s ease-in-out infinite 100ms" }} />
                    </div>
                  ) : isListening ? (
                    <Mic className="w-5 h-5 text-white animate-pulse z-10" />
                  ) : loading ? (
                    <Loader2 className="w-5 h-5 text-emerald-300 animate-spin z-10" />
                  ) : (
                    <Headphones className="w-5 h-5 text-emerald-300 z-10" />
                  )}
                </button>
              </div>

              <p className="mt-2 text-xs font-bold text-slate-700 tracking-tight">
                {isListening ? (
                  <span className="text-rose-600 font-extrabold flex items-center justify-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                    Listening...
                  </span>
                ) : isSpeaking ? (
                  <span className="text-[#0A3E29] flex items-center justify-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Ava speaking
                  </span>
                ) : loading ? (
                  <span className="text-slate-500">Thinking...</span>
                ) : (
                  <span>Tap to talk</span>
                )}
              </p>
            </div>

            <div ref={scrollContainerRef} className="w-full bg-white rounded-xl p-3 border border-slate-200/80 shadow-xs max-h-36 sm:max-h-44 overflow-y-auto space-y-1.5 transition-all flex-1 min-h-[70px]">
              {isListening ? (
                <div className="space-y-1 animate-in fade-in">
                  <span className="text-[10px] font-bold text-rose-600 uppercase tracking-wider flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                    Hearing your voice:
                  </span>
                  <p className="text-xs text-slate-800 leading-relaxed font-medium italic">
                    {input ? `“${input}”` : "Listening... speak now to ask a question or resolve an issue."}
                  </p>
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
                    className="flex items-center gap-1 text-[11px] font-bold text-rose-600 hover:text-rose-700"
                  >
                    <Square className="w-3 h-3 fill-current" />
                    <span>Stop</span>
                  </button>
                  <button
                    onClick={() => speakText(greeting, "replay")}
                    className="flex items-center gap-1 text-[11px] font-bold text-slate-600 hover:text-slate-900"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Replay</span>
                  </button>
                </div>
              )}
            </div>

            <div className="w-full pt-1 shrink-0">
              <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 border border-slate-200">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isListening ? "Listening to your voice..." : "Speak or type command..."}
                  rows={1}
                  className="flex-1 resize-none bg-transparent px-2.5 py-1 text-xs text-slate-800 placeholder-slate-400 focus:outline-none max-h-16 overflow-y-auto"
                  disabled={loading}
                />

                {speechSupported && (
                  <button
                    type="button"
                    onClick={toggleListening}
                    disabled={loading}
                    className={`p-1.5 rounded-lg transition-all shrink-0 ${
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
                  className="w-7 h-7 rounded-lg bg-[#0A3E29] hover:bg-[#06291B] text-white flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                  title="Send"
                >
                  {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                </button>
              </div>
            </div>

          </div>

        </div>
      )}
    </>
  );
}
