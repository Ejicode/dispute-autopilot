'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  X, 
  Send, 
  Bot, 
  User, 
  Sparkles, 
  Loader2, 
  ChevronDown, 
  Trash2,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Radio,
  Square,
  ShieldAlert,
  Flame,
  Award,
  CheckCircle2
} from 'lucide-react';
import { useUser } from './UserContext';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

// Clean markdown and symbols before speech synthesis
function cleanTextForSpeech(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1') // strip bold
    .replace(/`(.*?)`/g, '$1') // strip inline code
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1') // strip links
    .replace(/[•\-\*]\s+/g, '') // strip bullets
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '') // strip surrogate pair emojis
    .replace(/[#_~`]/g, '')
    .replace(/\n\n+/g, '. ')
    .replace(/\n/g, ', ')
    .trim();
}

// Simple markdown-like renderer for bold **text** and bullet points
function renderContent(text: string) {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    // Bold: **text**
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    const rendered = parts.map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={j} className="font-bold text-slate-900">{part.slice(2, -2)}</strong>;
      }
      return <span key={j}>{part}</span>;
    });

    // Bullet line
    if (line.startsWith('• ') || line.startsWith('- ') || /^\d+\. /.test(line)) {
      return (
        <div key={i} className="flex items-start gap-1.5 mt-0.5">
          <span className="text-[#0070BA] mt-0.5 shrink-0">•</span>
          <span className="flex-1">{rendered.map((p, j) => {
            return j === 0 ? <span key={j}>{(parts[0] || '').replace(/^[•\-]\s*/, '').replace(/^\d+\.\s*/, '')}{parts.slice(1).map((pp, k) => {
              if (pp.startsWith('**') && pp.endsWith('**')) {
                return <strong key={k} className="font-bold text-slate-900">{pp.slice(2, -2)}</strong>;
              }
              return <span key={k}>{pp}</span>;
            })}</span> : null;
          })}</span>
        </div>
      );
    }

    if (line === '') return <div key={i} className="h-1" />;

    return <div key={i}>{rendered}</div>;
  });
}

const HACKATHON_PROMPTS = [
  { label: '🏆 5 Stand-Out Features', query: 'What are the 5 stand-out features of Dispute Autopilot?' },
  { label: '🛡️ 7 Safety Rules', query: 'How do the 7 safety rules protect my PayPal account?' },
  { label: '🧪 Trust Lab Attacks', query: 'Explain the 6 live attack vectors tested in Trust Lab' },
  { label: '📊 40-Scenario Bench', query: 'What are the Dispute Bench results and processing speedup?' },
  { label: '⏰ Urgent Deadlines', query: 'Which disputes are expiring within 48 hours?' },
  { label: '💰 Capital at Risk', query: 'How much disputed money is currently at risk?' },
  { label: '⚖️ Code Claim Verifier', query: 'How does the Deterministic Code Claim Verifier work?' },
];

export default function AiAssistant() {
  const { activeUser } = useUser();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [minimized, setMinimized] = useState(false);

  // ── Voice State ──
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [voiceAudioEnabled, setVoiceAudioEnabled] = useState(false);
  const [currentlySpeakingId, setCurrentlySpeakingId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  // Check speech recognition support and load voice preference
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const hasSpeechRecognition = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
      setSpeechSupported(hasSpeechRecognition);

      const savedAudio = localStorage.getItem('ai_voice_audio_enabled');
      if (savedAudio === 'true') {
        setVoiceAudioEnabled(true);
      }
    }
  }, []);

  // Cleanup speech on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  // Speak text helper
  const speakText = useCallback((text: string, messageId: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    window.speechSynthesis.cancel();
    setCurrentlySpeakingId(messageId);

    const clean = cleanTextForSpeech(text);
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    // Pick a natural English voice if available
    const voices = window.speechSynthesis.getVoices();
    const englishVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha')));
    if (englishVoice) {
      utterance.voice = englishVoice;
    }

    utterance.onend = () => {
      setCurrentlySpeakingId(null);
    };

    utterance.onerror = () => {
      setCurrentlySpeakingId(null);
    };

    window.speechSynthesis.speak(utterance);
  }, []);

  const stopSpeaking = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setCurrentlySpeakingId(null);
    }
  };

  const toggleVoiceAudio = () => {
    const next = !voiceAudioEnabled;
    setVoiceAudioEnabled(next);
    localStorage.setItem('ai_voice_audio_enabled', String(next));
    if (!next) {
      stopSpeaking();
    }
  };

  // Toggle Microphone Listening
  const toggleListening = () => {
    if (typeof window === 'undefined') return;

    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser. Please use Chrome or Edge.');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setInput(transcript);
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error('Failed to start speech recognition:', err);
      setIsListening(false);
    }
  };

  // Load history when opened
  useEffect(() => {
    if (open && activeUser && messages.length === 0) {
      loadHistory();
    }
  }, [open, activeUser]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (open && !minimized) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }, [messages, open, minimized]);

  const loadHistory = async () => {
    if (!activeUser) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/ai-assistant?user_id=${activeUser.id}`);
      const data = await res.json();
      if (data.messages?.length > 0) {
        setMessages(data.messages);
      } else {
        // Welcome message with hackathon briefing
        setMessages([{
          id: 'welcome',
          role: 'assistant',
          content: `👋 Hello **${activeUser.name}**! I'm your **Dispute Autopilot AI Assistant** (PayPal AI Hackathon 2026 Edition).\n\n` +
            `I have real-time access to your store **${activeUser.store_name || 'Protected Store'}** and complete knowledge of PayPal Seller Protection rules and hackathon technical requirements.\n\n` +
            `🎙️ **Voice Enabled:** Tap the mic to speak to me, or enable audio to hear my spoken answers!\n\n` +
            `Ask me anything about your active cases, our **5 Stand-Out Features**, the **7 Safety Rules**, or click a quick prompt below:`,
          created_at: new Date().toISOString(),
        }]);
      }
    } catch (_) {
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: `👋 Hello! I'm your **Dispute Autopilot AI Assistant**. Ask me about your disputes, orders, or hackathon requirements.`,
        created_at: new Date().toISOString(),
      }]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const sendMessage = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || loading || !activeUser) return;
    setInput('');
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }

    const userMsg: Message = {
      id: 'tmp_' + Date.now(),
      role: 'user',
      content: msg,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch('/api/ai-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, user_id: activeUser.id }),
      });
      const data = await res.json();
      if (data.message) {
        setMessages((prev) => [...prev, data.message]);

        // Auto-speak if audio is enabled
        if (voiceAudioEnabled) {
          speakText(data.message.content, data.message.id);
        }
      }
    } catch (_) {
      setMessages((prev) => [...prev, {
        id: 'err_' + Date.now(),
        role: 'assistant',
        content: '⚠️ Connection error. Please try again.',
        created_at: new Date().toISOString(),
      }]);
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = async () => {
    stopSpeaking();
    setMessages([]);
    if (activeUser) {
      setTimeout(() => loadHistory(), 100);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!activeUser) return null;

  return (
    <>
      {/* ── Floating Bubble Launcher ── */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-[#003087] via-[#0070BA] to-[#009CDE] shadow-xl shadow-blue-900/40 flex items-center justify-center hover:scale-110 active:scale-95 transition-all duration-200 group ring-4 ring-white/20"
          title="Open PayPal AI Assistant"
        >
          <Bot className="w-6 h-6 text-white group-hover:scale-110 transition-transform" />
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#FFC439] border-2 border-white flex items-center justify-center">
            <Sparkles className="w-2.5 h-2.5 text-amber-900" />
          </span>
        </button>
      )}

      {/* ── Main Chat Panel ── */}
      {open && (
        <div className={`fixed bottom-6 right-6 z-50 w-[420px] max-w-[calc(100vw-24px)] rounded-3xl shadow-2xl shadow-slate-900/30 border border-slate-200/90 bg-white flex flex-col overflow-hidden transition-all duration-300 animate-in slide-in-from-bottom-4 fade-in ${minimized ? 'h-16' : 'h-[620px]'}`}>
          
          {/* ── Header ── */}
          <div className="bg-gradient-to-r from-[#003087] via-[#0070BA] to-[#0086CE] px-4 py-3 flex items-center justify-between shrink-0 text-white">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center shrink-0 border border-white/25">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-white font-bold text-sm leading-tight">PayPal AI Assistant</p>
                  <span className="px-1.5 py-0.2 rounded-full bg-[#FFC439] text-[#003087] text-[8px] font-extrabold uppercase tracking-wider">
                    VOICE AI
                  </span>
                </div>
                <p className="text-white/80 text-[10px]">Hackathon Edition · Live Data Grounded</p>
              </div>
            </div>

            {/* Controls: Audio Toggle, Clear, Minimize, Close */}
            <div className="flex items-center gap-1">
              <button
                onClick={toggleVoiceAudio}
                className={`p-1.5 rounded-xl transition-all ${
                  voiceAudioEnabled 
                    ? 'bg-[#FFC439] text-[#003087] font-bold shadow-sm' 
                    : 'hover:bg-white/10 text-white/70 hover:text-white'
                }`}
                title={voiceAudioEnabled ? 'Voice Audio: ON (Click to Mute)' : 'Voice Audio: OFF (Click to Enable Auto-Speech)'}
              >
                {voiceAudioEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              </button>

              <button
                onClick={clearHistory}
                className="p-1.5 rounded-xl hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                title="Reset conversation"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => setMinimized(!minimized)}
                className="p-1.5 rounded-xl hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                title={minimized ? 'Expand' : 'Minimize'}
              >
                <ChevronDown className={`w-4 h-4 transition-transform ${minimized ? 'rotate-180' : ''}`} />
              </button>

              <button
                onClick={() => { stopSpeaking(); setOpen(false); }}
                className="p-1.5 rounded-xl hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {!minimized && (
            <>
              {/* ── Active Speech Indicator Banner ── */}
              {currentlySpeakingId && (
                <div className="bg-amber-50 border-b border-amber-200 px-3 py-1.5 flex items-center justify-between text-xs text-amber-900 animate-pulse">
                  <div className="flex items-center gap-2">
                    <Radio className="w-3.5 h-3.5 text-amber-600 animate-spin" />
                    <span className="font-semibold text-[11px]">AI is speaking aloud...</span>
                  </div>
                  <button
                    onClick={stopSpeaking}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-200/80 hover:bg-amber-300 text-amber-900 text-[10px] font-bold transition-colors"
                  >
                    <Square className="w-2.5 h-2.5 fill-current" />
                    <span>Stop Audio</span>
                  </button>
                </div>
              )}

              {/* ── Message Transcript ── */}
              <div className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-slate-50/60">
                {historyLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="w-6 h-6 animate-spin text-[#0070BA]" />
                  </div>
                ) : (
                  <>
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex items-start gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                      >
                        {/* Avatar */}
                        <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                          msg.role === 'assistant'
                            ? 'bg-gradient-to-br from-[#003087] to-[#0070BA] text-white shadow-sm'
                            : 'bg-slate-200 text-slate-700'
                        }`}>
                          {msg.role === 'assistant' ? (
                            <Bot className="w-4 h-4" />
                          ) : (
                            <User className="w-4 h-4" />
                          )}
                        </div>

                        {/* Bubble */}
                        <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-sm transition-all ${
                          msg.role === 'assistant'
                            ? 'bg-white border border-slate-200/90 text-slate-700 rounded-tl-sm'
                            : 'bg-[#0070BA] text-white rounded-tr-sm'
                        }`}>
                          <div className="space-y-1">
                            {renderContent(msg.content)}
                          </div>

                          {/* Footer with time and optional Speak button */}
                          <div className="flex items-center justify-between mt-2 pt-1 border-t border-slate-100/60">
                            <span className={`text-[9px] ${msg.role === 'assistant' ? 'text-slate-400' : 'text-white/70'}`}>
                              {new Date(msg.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                            </span>

                            {msg.role === 'assistant' && (
                              <button
                                onClick={() => {
                                  if (currentlySpeakingId === msg.id) {
                                    stopSpeaking();
                                  } else {
                                    speakText(msg.content, msg.id);
                                  }
                                }}
                                className="flex items-center gap-1 text-[10px] font-semibold text-[#0070BA] hover:text-[#003087] px-1.5 py-0.5 rounded hover:bg-blue-50 transition-colors ml-2"
                                title="Listen to this message"
                              >
                                {currentlySpeakingId === msg.id ? (
                                  <>
                                    <Square className="w-2.5 h-2.5 fill-current" />
                                    <span>Stop</span>
                                  </>
                                ) : (
                                  <>
                                    <Volume2 className="w-3 h-3" />
                                    <span>Listen</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Typing Animation */}
                    {loading && (
                      <div className="flex items-start gap-2.5">
                        <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-[#003087] to-[#0070BA] text-white flex items-center justify-center shrink-0">
                          <Bot className="w-4 h-4" />
                        </div>
                        <div className="bg-white border border-slate-200/90 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#0070BA] animate-bounce" style={{ animationDelay: '0ms' }} />
                            <span className="w-1.5 h-1.5 rounded-full bg-[#0070BA] animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-1.5 h-1.5 rounded-full bg-[#0070BA] animate-bounce" style={{ animationDelay: '300ms' }} />
                          </div>
                        </div>
                      </div>
                    )}

                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>

              {/* ── Hackathon Quick Questions Carousel ── */}
              {messages.length <= 2 && !loading && (
                <div className="px-3.5 py-2.5 border-t border-slate-100 bg-white">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-[#FFC439]" /> PayPal Hackathon Topics
                    </p>
                    <span className="text-[9px] text-slate-400">Click to ask</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                    {HACKATHON_PROMPTS.map((prompt) => (
                      <button
                        key={prompt.label}
                        onClick={() => sendMessage(prompt.query)}
                        className="px-2.5 py-1 rounded-full bg-blue-50/80 hover:bg-blue-100 text-[#0070BA] text-[11px] font-semibold border border-blue-200/70 transition-colors shrink-0 text-left"
                      >
                        {prompt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Active Microphone Listening Banner ── */}
              {isListening && (
                <div className="bg-rose-50 border-t border-rose-200 px-3 py-2 flex items-center justify-between text-xs text-rose-800 animate-pulse">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-ping" />
                    <span className="font-bold">Listening... Speak into your microphone</span>
                  </div>
                  <button
                    onClick={toggleListening}
                    className="text-[10px] font-bold text-rose-700 bg-rose-200/60 px-2 py-0.5 rounded hover:bg-rose-200 transition-colors"
                  >
                    Done Speaking
                  </button>
                </div>
              )}

              {/* ── Input Box & Controls ── */}
              <div className="border-t border-slate-100 p-3 bg-white shrink-0">
                <div className="flex items-end gap-2">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={isListening ? "Listening... your voice will appear here" : "Ask about PayPal rules, features, active cases..."}
                    rows={1}
                    className="flex-1 resize-none rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#0070BA] focus:ring-2 focus:ring-[#0070BA]/20 transition-all max-h-28 overflow-y-auto"
                    style={{ lineHeight: '1.5' }}
                    disabled={loading}
                  />

                  {/* Microphone Button */}
                  {speechSupported && (
                    <button
                      type="button"
                      onClick={toggleListening}
                      disabled={loading}
                      className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all shrink-0 ${
                        isListening
                          ? 'bg-rose-600 text-white animate-pulse shadow-md shadow-rose-600/30 ring-2 ring-rose-400'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                      }`}
                      title={isListening ? "Stop Listening" : "Speak with Voice (Dictation)"}
                    >
                      {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </button>
                  )}

                  {/* Send Button */}
                  <button
                    type="button"
                    onClick={() => sendMessage()}
                    disabled={!input.trim() || loading}
                    className="w-9 h-9 rounded-xl bg-[#0070BA] hover:bg-[#003087] text-white flex items-center justify-center transition-all shadow-md shadow-blue-800/20 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                    title="Send Message"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </button>
                </div>

                <div className="flex items-center justify-between text-[9px] text-slate-400 mt-1.5 px-0.5">
                  <span>Enter to send · Shift+Enter for newline</span>
                  <span className="flex items-center gap-1 font-semibold text-slate-500">
                    <Mic className="w-2.5 h-2.5 text-[#0070BA]" /> Voice I/O Enabled
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
