'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Shield, ShieldCheck, Radio, AlertTriangle, Clock, ShoppingCart, Activity, FileCheck, X } from 'lucide-react';
import { useRealtime } from './RealtimeContext';

export default function Navbar() {
  const pathname = usePathname();
  const { isConnected, notifications, dismissNotification, lastEvent } = useRealtime();
  const [metrics, setMetrics] = useState({ totalAtRiskCents: 142500, expiring48hCount: 2 });

  useEffect(() => {
    async function fetchMetrics() {
      try {
        const res = await fetch('/api/disputes');
        if (res.ok) {
          const data = await res.json();
          if (data.metrics) {
            setMetrics({
              totalAtRiskCents: data.metrics.totalAtRiskCents,
              expiring48hCount: data.metrics.expiring48hCount,
            });
          }
        }
      } catch {}
    }
    fetchMetrics();
  }, [lastEvent]);

  const navLinks = [
    { href: '/', label: 'Dispute Queue', icon: Shield },
    { href: '/storefront', label: 'Storefront', icon: ShoppingCart },
    { href: '/trust-lab', label: 'Trust Lab', icon: Activity },
    { href: '/bench', label: 'Bench (40)', icon: FileCheck },
  ];

  return (
    <>
      <header className="sticky top-0 z-50 bg-[#080d1c]/90 backdrop-blur-xl border-b border-white/[0.06] shadow-[0_1px_0_rgba(255,255,255,0.04)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">

            {/* Logo */}
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#003087] to-[#0070BA] flex items-center justify-center shadow-[0_4px_12px_rgba(0,112,186,0.4)] group-hover:shadow-[0_4px_20px_rgba(0,112,186,0.6)] transition-all">
                <ShieldCheck className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[15px] text-white tracking-tight">Dispute Autopilot</span>
                  <span className="text-[9px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full bg-[#FFC439]/15 text-[#FFC439] border border-[#FFC439]/25">
                    PayPal AI
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 block leading-none mt-0.5">Tamper-evident agentic dispute defense</span>
              </div>
            </Link>

            {/* Navigation */}
            <nav className="hidden md:flex items-center gap-1 bg-white/[0.03] rounded-xl border border-white/[0.06] px-1.5 py-1.5">
              {navLinks.map((link) => {
                const Icon = link.icon;
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-all ${
                      isActive
                        ? 'bg-[#0070BA]/20 text-[#0070BA] border border-[#0070BA]/30 shadow-[0_0_12px_rgba(0,112,186,0.15)]'
                        : 'text-slate-400 hover:text-white hover:bg-white/[0.06] border border-transparent'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isActive ? 'text-[#0070BA]' : 'text-slate-500'}`} />
                    {link.label}
                  </Link>
                );
              })}
            </nav>

            {/* Right: metrics + live badge */}
            <div className="flex items-center gap-2.5">
              {/* Money at risk */}
              <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-medium">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>
                  <strong className="font-bold">${(metrics.totalAtRiskCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong> at risk
                </span>
                <span className="text-amber-600">·</span>
                <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>{metrics.expiring48hCount} exp. 48h</span>
              </div>

              {/* SSE live badge */}
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
                  isConnected
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                }`}
                title={isConnected ? 'Connected to live SSE stream' : 'Reconnecting...'}
              >
                <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
                <span>{isConnected ? 'LIVE' : 'OFFLINE'}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Toast notifications */}
      <aside aria-label="Live System Notifications" className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {notifications.map((n) => (
          <div
            key={n.id}
            className="pointer-events-auto bg-[#0d1225]/95 backdrop-blur-xl text-white px-4 py-3 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] border border-white/[0.08] flex items-start justify-between gap-3 text-xs animate-in slide-in-from-bottom-3 duration-200"
          >
            <div className="flex items-start gap-2.5">
              <Radio className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0 animate-pulse" />
              <div>
                <p className="font-medium text-slate-100">{n.message}</p>
                <span className="text-[10px] text-slate-500">{new Date(n.timestamp).toLocaleTimeString()}</span>
              </div>
            </div>
            <button onClick={() => dismissNotification(n.id)} className="text-slate-500 hover:text-white p-0.5 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </aside>
    </>
  );
}
