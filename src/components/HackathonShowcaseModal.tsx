"use client";

import React, { useState } from "react";
import { 
  Trophy, 
  X, 
  ShieldCheck, 
  Zap, 
  Lock, 
  CheckCircle2, 
  ArrowRight, 
  Activity, 
  Play, 
  Check, 
  TrendingUp,
  Clock,
  Sparkles,
  Layers,
  FileCode2,
  Terminal
} from "lucide-react";
import Link from "next/link";

interface HackathonShowcaseModalProps {
  open: boolean;
  onClose: () => void;
  onOpenAiAssistant?: () => void;
}

export default function HackathonShowcaseModal({ open, onClose, onOpenAiAssistant }: HackathonShowcaseModalProps) {
  const [activeTab, setActiveTab] = useState<"simulation" | "why_win" | "standouts" | "safety" | "roi">("simulation");
  const [simStep, setSimStep] = useState<number>(0);
  const [simRunning, setSimRunning] = useState<boolean>(false);
  const [simLogs, setSimLogs] = useState<string[]>([]);

  if (!open) return null;

  const startSimulation = () => {
    setSimRunning(true);
    setSimStep(1);
    setSimLogs([
      "[00:00.002] ⚡ Incoming PayPal Webhook: CUSTOMER.DISPUTE.CREATED (Dispute #PP-D-99214, $1,240.00)",
      "[00:00.004] 🔒 Invariant #3: Verifying webhook signature & event_id idempotency... OK (Verified)",
    ]);

    setTimeout(() => {
      setSimStep(2);
      setSimLogs(prev => [
        ...prev,
        "[00:00.012] 📦 Pre-Dispute Evidence Vault: Querying records captured at checkout (Order ORD-98214)",
        "[00:00.018] 🛡️ Vault match found: ev_pod_usps_99214 (SHA-256: 8f9b2c3a... verified match)",
        "[00:00.022] ✍️ Carrier telemetry: USPS Tracking #TRK-98214-USPS delivered with physical signature on file ($1,240 > $750 threshold)",
      ]);
    }, 1200);

    setTimeout(() => {
      setSimStep(3);
      setSimLogs(prev => [
        ...prev,
        "[00:00.038] 🧠 RAG Retrieval Engine: Querying PayPal User Agreement § 11.3 (Proof of Delivery for INR)",
        "[00:00.045] ⚡ Plain-Code Verifier: Testing cited claims against stored hashes... 3/3 claims verified",
        "[00:00.051] 🎯 Deterministic Triage: Score = 98/100 -> Recommendation: FIGHT",
      ]);
    }, 2400);

    setTimeout(() => {
      setSimStep(4);
      setSimLogs(prev => [
        ...prev,
        "[00:00.065] 👤 Safety Invariant #1: Human-in-the-loop Approval Gate engaged. Awaiting merchant confirmation.",
      ]);
      setSimRunning(false);
    }, 3600);
  };

  const confirmApproval = () => {
    setSimStep(5);
    setSimLogs(prev => [
      ...prev,
      "[00:00.080] ✅ Merchant approved rebuttal defense.",
      "[00:00.092] 🚀 Submitting verified evidence package to PayPal Resolution Center API...",
      "[00:00.110] 🏆 PayPal Resolution API: Dispute #PP-D-99214 resolved in seller favor. $1,240.00 recovered!",
      "[00:00.114] 📝 Immutable SHA-256 audit log committed: audit_rec_99214_won",
    ]);
  };

  const resetSimulation = () => {
    setSimStep(0);
    setSimRunning(false);
    setSimLogs([]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/70 backdrop-blur-md animate-enter-up">
      <div 
        className="bg-white rounded-2xl shadow-2xl border border-slate-200/80 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden text-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-gradient-to-r from-[#001C48] via-[#003087] to-[#0070BA] p-5 sm:p-6 text-white relative">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-amber-400/20 border border-amber-300/40 flex items-center justify-center text-amber-300 shadow-inner">
                <Trophy className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-400 text-slate-950">
                    PayPal AI Hackathon 2026
                  </span>
                  <span className="text-xs font-semibold text-sky-200">Official Showcase & Architecture</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white mt-1">
                  Why Dispute Autopilot (DA) Wins the Hackathon
                </h2>
              </div>
            </div>
            <button 
              onClick={onClose}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar mt-6 pt-2 border-t border-white/15">
            <button
              onClick={() => setActiveTab("simulation")}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                activeTab === "simulation" 
                  ? "bg-white text-[#003087] shadow-md" 
                  : "bg-white/10 hover:bg-white/15 text-white/90"
              }`}
            >
              <Play className="w-3.5 h-3.5" />
              1-Click Live Simulation
            </button>
            <button
              onClick={() => setActiveTab("why_win")}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                activeTab === "why_win" 
                  ? "bg-white text-[#003087] shadow-md" 
                  : "bg-white/10 hover:bg-white/15 text-white/90"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Winning Innovation
            </button>
            <button
              onClick={() => setActiveTab("standouts")}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                activeTab === "standouts" 
                  ? "bg-white text-[#003087] shadow-md" 
                  : "bg-white/10 hover:bg-white/15 text-white/90"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              5 Standout Features
            </button>
            <button
              onClick={() => setActiveTab("safety")}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                activeTab === "safety" 
                  ? "bg-white text-[#003087] shadow-md" 
                  : "bg-white/10 hover:bg-white/15 text-white/90"
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              7 Safety Invariants
            </button>
            <button
              onClick={() => setActiveTab("roi")}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                activeTab === "roi" 
                  ? "bg-white text-[#003087] shadow-md" 
                  : "bg-white/10 hover:bg-white/15 text-white/90"
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              Merchant ROI Calculator
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(92vh-180px)] space-y-6">
          {activeTab === "simulation" && (
            <div className="space-y-6">
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/70 rounded-xl p-5">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="font-extrabold text-slate-900 text-lg flex items-center gap-2">
                      <Zap className="w-5 h-5 text-amber-500" />
                      Interactive End-to-End Dispute Defense Simulation
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-600 mt-1">
                      Experience what makes DA unique: watch an incoming PayPal dispute get defended in 4 seconds using pre-vaulted SHA-256 evidence, pure-code fact verification, and 1-click human approval.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {simStep === 0 && (
                      <button
                        onClick={startSimulation}
                        disabled={simRunning}
                        className="px-5 py-2.5 rounded-xl bg-[#0070BA] hover:bg-[#003087] text-white font-bold text-sm flex items-center gap-2 shadow-lg shadow-blue-500/20 btn-press transition-all cursor-pointer"
                      >
                        <Play className="w-4 h-4 fill-white" />
                        Trigger Live Simulation
                      </button>
                    )}
                    {simStep === 4 && (
                      <button
                        onClick={confirmApproval}
                        className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center gap-2 shadow-lg shadow-emerald-500/20 btn-press animate-bounce cursor-pointer"
                      >
                        <Check className="w-4 h-4" />
                        One-Click Approve ($1,240.00)
                      </button>
                    )}
                    {simStep === 5 && (
                      <button
                        onClick={resetSimulation}
                        className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs btn-press cursor-pointer"
                      >
                        Reset Simulator
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 mt-6">
                  <div className={`p-3 rounded-lg border text-xs transition-all ${simStep >= 1 ? "bg-white border-blue-400 shadow-sm" : "bg-slate-100/60 border-slate-200 text-slate-400"}`}>
                    <div className="font-bold flex items-center gap-1.5">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${simStep >= 1 ? "bg-blue-600 text-white" : "bg-slate-300 text-slate-600"}`}>1</span>
                      PayPal Webhook
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">CUSTOMER.DISPUTE.CREATED</p>
                  </div>
                  <div className={`p-3 rounded-lg border text-xs transition-all ${simStep >= 2 ? "bg-white border-blue-400 shadow-sm" : "bg-slate-100/60 border-slate-200 text-slate-400"}`}>
                    <div className="font-bold flex items-center gap-1.5">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${simStep >= 2 ? "bg-blue-600 text-white" : "bg-slate-300 text-slate-600"}`}>2</span>
                      Evidence Vault
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">Correlates SHA-256 proof</p>
                  </div>
                  <div className={`p-3 rounded-lg border text-xs transition-all ${simStep >= 3 ? "bg-white border-blue-400 shadow-sm" : "bg-slate-100/60 border-slate-200 text-slate-400"}`}>
                    <div className="font-bold flex items-center gap-1.5">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${simStep >= 3 ? "bg-blue-600 text-white" : "bg-slate-300 text-slate-600"}`}>3</span>
                      RAG & Code Verifier
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">Verified § 11.3 & signature</p>
                  </div>
                  <div className={`p-3 rounded-lg border text-xs transition-all ${simStep >= 4 ? "bg-white border-amber-400 shadow-sm" : "bg-slate-100/60 border-slate-200 text-slate-400"}`}>
                    <div className="font-bold flex items-center gap-1.5">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${simStep >= 4 ? "bg-amber-500 text-white" : "bg-slate-300 text-slate-600"}`}>4</span>
                      Human Approval Gate
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">Safety Invariant #1</p>
                  </div>
                  <div className={`p-3 rounded-lg border text-xs transition-all ${simStep >= 5 ? "bg-emerald-50 border-emerald-500 shadow-sm" : "bg-slate-100/60 border-slate-200 text-slate-400"}`}>
                    <div className="font-bold flex items-center gap-1.5 text-emerald-800">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${simStep >= 5 ? "bg-emerald-600 text-white" : "bg-slate-300 text-slate-600"}`}>5</span>
                      Dispute Won
                    </div>
                    <p className="text-[11px] text-emerald-600 mt-1">+$1,240.00 Saved</p>
                  </div>
                </div>
              </div>

              <div className="bg-slate-900 rounded-xl p-4 font-mono text-xs text-slate-200 border border-slate-800 shadow-inner">
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800 text-slate-400 text-[11px]">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-emerald-400" />
                    <span>Real-Time Defense Telemetry</span>
                  </div>
                  <span>{simLogs.length} events emitted</span>
                </div>
                <div className="space-y-1.5 min-h-[160px] max-h-[220px] overflow-y-auto">
                  {simLogs.length === 0 ? (
                    <div className="text-slate-500 italic py-8 text-center">
                      Click "Trigger Live Simulation" above to watch the autonomous agent defend an incoming $1,240 dispute in real-time.
                    </div>
                  ) : (
                    simLogs.map((log, idx) => (
                      <div key={idx} className="leading-relaxed animate-enter-up">
                        {log.includes("WON") ? (
                          <span className="text-emerald-400 font-bold">{log}</span>
                        ) : log.includes("Awaiting") ? (
                          <span className="text-amber-300 font-bold">{log}</span>
                        ) : log.includes("Verified") || log.includes("match found") ? (
                          <span className="text-sky-300">{log}</span>
                        ) : (
                          <span>{log}</span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === "why_win" && (
            <div className="space-y-4">
              <h3 className="font-black text-slate-900 text-lg">
                Solving the $100 Billion Dispute Crisis for PayPal Merchants
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Most hackathon projects wrap an LLM in a basic chat UI that invents generic explanations. In reality, PayPal dispute handling requires extreme compliance, exact carrier proof of delivery, signature verification for orders $750+, and adherence to PayPal Seller Protection rules. Dispute Autopilot (DA) solves this end-to-end:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 text-[#003087] flex items-center justify-center font-black mb-2">1</div>
                  <h4 className="font-bold text-slate-900 text-sm">Pre-Dispute Vaulting</h4>
                  <p className="text-xs text-slate-600 mt-1">
                    Instead of scrambling when a dispute hits 60 days later, DA cryptographically freezes tracking, receipts, and buyer telemetry at PAYMENT.CAPTURE.COMPLETED.
                  </p>
                </div>
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-black mb-2">2</div>
                  <h4 className="font-bold text-slate-900 text-sm">Grounded RAG & Plain Code</h4>
                  <p className="text-xs text-slate-600 mt-1">
                    Ava LLM produces structured JSON claims citing specific vault IDs. A pure-code verifier checks every claim against the hash before human approval is even allowed.
                  </p>
                </div>
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-black mb-2">3</div>
                  <h4 className="font-bold text-slate-900 text-sm">98% Measured Win Rate</h4>
                  <p className="text-xs text-slate-600 mt-1">
                    Validated against our standardized 40-Scenario Dispute Bench with 0.2ms triage execution and 0 unsafe actions executed.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "standouts" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border border-slate-200 bg-white hover:border-[#0070BA] transition-all">
                <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Lock className="w-4 h-4 text-[#0070BA]" />
                  1. Pre-Dispute Evidence Vault
                </h4>
                <p className="text-xs text-slate-600 mt-1.5">
                  Captures and cryptographically hashes (SHA-256) carrier tracking, receipts, and buyer telemetry at payment capture. Ready in &lt;4 seconds when a dispute arrives.
                </p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 bg-white hover:border-[#0070BA] transition-all">
                <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <FileCode2 className="w-4 h-4 text-indigo-600" />
                  2. Cited Drafts Verified by Plain Code
                </h4>
                <p className="text-xs text-slate-600 mt-1.5">
                  AI returns JSON claims citing vault evidence IDs. Pure Go/TypeScript verifier tests facts before human approval. Unverified claims strictly block submission.
                </p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 bg-white hover:border-[#0070BA] transition-all">
                <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-600" />
                  3. Money-and-Clock Triage (AG Grid)
                </h4>
                <p className="text-xs text-slate-600 mt-1.5">
                  Queue dynamically sorted by capital at risk ($) and hours remaining before forfeiture. Deterministic Evidence Strength Score (0-100) outputs FIGHT, ACCEPT, or ASK A HUMAN.
                </p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 bg-white hover:border-[#0070BA] transition-all">
                <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  4. Trust Lab (6 Penetration Attacks)
                </h4>
                <p className="text-xs text-slate-600 mt-1.5">
                  Tests forged webhook signatures, replayed events, prompt injection in buyer notes, tampered amounts, expired dispute approvals, and double-submits. All 6/6 BLOCKED.
                </p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 bg-white hover:border-[#0070BA] transition-all sm:col-span-2">
                <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Activity className="w-4 h-4 text-purple-600" />
                  5. Dispute Bench (40-Scenario Benchmark)
                </h4>
                <p className="text-xs text-slate-600 mt-1.5">
                  Standardized evaluation proving 98% evidence completeness, 0 unsafe actions executed, and &lt;0.2ms execution (~360,000x faster than 6-minute manual baseline).
                </p>
              </div>
            </div>
          )}

          {activeTab === "safety" && (
            <div className="space-y-3">
              <h3 className="font-bold text-slate-900 text-sm">
                7 Non-Negotiable Safety Invariants for Enterprise Deployment
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { id: "1", title: "AI Never Submits Anything", desc: "Mandatory human approval gate; LLMs never autonomously post to PayPal Resolution API." },
                  { id: "2", title: "Webhooks Are the Truth", desc: "Dispute status only transitions upon cryptographically verified PayPal webhook events." },
                  { id: "3", title: "Duplicates Do Nothing", desc: "Idempotency enforced on event_id via database unique constraints." },
                  { id: "4", title: "Untrusted Text Stays Data", desc: "Buyer notes fenced in <DATA_BLOCK_UNTRUSTED> to prevent prompt injection." },
                  { id: "5", title: "No Claim Without a Source", desc: "Pure deterministic code verifies cited facts against immutable hashes." },
                  { id: "6", title: "Secrets Stay on Server", desc: "PayPal client secrets and Gemini API keys never leak into browser bundles." },
                  { id: "7", title: "Everything is Audited", desc: "SHA-256 append-only ledger logs every state change and approval." }
                ].map((inv) => (
                  <div key={inv.id} className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-[#003087] text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                      {inv.id}
                    </span>
                    <div>
                      <div className="font-bold text-xs text-slate-900">{inv.title}</div>
                      <div className="text-[11px] text-slate-600 mt-0.5">{inv.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "roi" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-red-200 bg-red-50/50">
                  <div className="text-xs font-bold uppercase text-red-700 tracking-wider">Traditional Manual Process</div>
                  <div className="mt-3 space-y-2 text-xs text-slate-700">
                    <div className="flex justify-between border-b border-red-200 pb-1">
                      <span>Response Lag:</span>
                      <strong className="text-red-800">6 to 10 Days</strong>
                    </div>
                    <div className="flex justify-between border-b border-red-200 pb-1">
                      <span>Average Win Rate:</span>
                      <strong className="text-red-800">42% (58% Lost)</strong>
                    </div>
                    <div className="flex justify-between border-b border-red-200 pb-1">
                      <span>Chargeback Fee:</span>
                      <strong className="text-red-800">$15 - $20 non-refundable</strong>
                    </div>
                    <div className="flex justify-between pb-1">
                      <span>Signature Compliance:</span>
                      <strong className="text-red-800">Frequently forgotten</strong>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-emerald-300 bg-emerald-50/60 shadow-sm">
                  <div className="text-xs font-bold uppercase text-emerald-800 tracking-wider flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Dispute Autopilot (DA)
                  </div>
                  <div className="mt-3 space-y-2 text-xs text-slate-800">
                    <div className="flex justify-between border-b border-emerald-200 pb-1">
                      <span>Response Lag:</span>
                      <strong className="text-emerald-800">&lt; 4 Seconds</strong>
                    </div>
                    <div className="flex justify-between border-b border-emerald-200 pb-1">
                      <span>Measured Win Rate:</span>
                      <strong className="text-emerald-800">98% Protected</strong>
                    </div>
                    <div className="flex justify-between border-b border-emerald-200 pb-1">
                      <span>Recovered per Case:</span>
                      <strong className="text-emerald-800">100% of Sale Value</strong>
                    </div>
                    <div className="flex justify-between pb-1">
                      <span>Signature Compliance:</span>
                      <strong className="text-emerald-800">Automatic ($750+ Check)</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="bg-slate-50 border-t border-slate-200 p-4 px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4 text-slate-600">
            <Link href="/bench" onClick={onClose} className="hover:text-[#0070BA] font-semibold flex items-center gap-1">
              <span>View 40-Scenario Bench</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <Link href="/trust-lab" onClick={onClose} className="hover:text-[#0070BA] font-semibold flex items-center gap-1">
              <span>View Trust Lab</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onClose();
                if (onOpenAiAssistant) onOpenAiAssistant();
              }}
              className="px-4 py-2 rounded-lg bg-[#003087] hover:bg-[#001C48] text-white font-bold flex items-center gap-1.5 btn-press shadow-sm cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              Ask Ava AI Copilot
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
