'use client';

import React from 'react';
import Link from 'next/link';

interface LogoProps {
  collapsed?: boolean;
  variant?: 'dark' | 'light';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showSubtitle?: boolean;
  href?: string;
  className?: string;
}

export default function Logo({
  collapsed = false,
  variant = 'dark',
  size = 'md',
  showSubtitle = true,
  href = '/',
  className = '',
}: LogoProps) {
  const isLight = variant === 'light';

  const sizeMap = {
    sm: { box: 'w-10 h-10 rounded-xl', icon: 'w-6 h-6', title: 'text-base font-black', sub: 'text-[9.5px]' },
    md: { box: 'w-12 h-12 rounded-2xl', icon: 'w-8 h-8', title: 'text-xl font-black', sub: 'text-[11px]' },
    lg: { box: 'w-14 h-14 rounded-2xl', icon: 'w-9 h-9', title: 'text-2xl font-black', sub: 'text-[12px]' },
    xl: { box: 'w-16 h-16 rounded-3xl', icon: 'w-11 h-11', title: 'text-3xl font-black', sub: 'text-[13.5px]' },
  };

  const s = sizeMap[size] || sizeMap.md;

  const content = (
    <div className={`flex items-center gap-3 group select-none ${className}`}>
      {/* ── DA Aerodynamic Dispute Autopilot Shield Emblem ── */}
      <div
        className={`${s.box} bg-gradient-to-br from-[#001C48] via-[#003087] to-[#0070BA] flex items-center justify-center shrink-0 relative overflow-hidden shadow-sm border border-blue-400/30 group-hover:shadow-md group-hover:border-blue-300/60 transition-all duration-300`}
        style={{
          boxShadow: isLight
            ? '0 4px 14px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.25)'
            : '0 4px 14px rgba(0,48,135,0.25), inset 0 1px 0 rgba(255,255,255,0.35)',
        }}
      >
        {/* Specular Gloss Highlight & Ambient Radial Core */}
        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/15 to-white/30 pointer-events-none" />
        <div className="absolute -top-4 -right-4 w-8 h-8 rounded-full bg-[#00A6E0]/25 blur-sm pointer-events-none" />

        <svg
          viewBox="0 0 36 36"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`${s.icon} relative z-10 transition-transform duration-300 group-hover:scale-110 drop-shadow-[0_2px_4px_rgba(0,28,72,0.4)]`}
        >
          <defs>
            {/* Primary DA Cyan/Sky Flight Gradient */}
            <linearGradient id="daWingGrad" x1="4" y1="4" x2="32" y2="32" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="35%" stopColor="#E0F2FE" />
              <stop offset="70%" stopColor="#38BDF8" />
              <stop offset="100%" stopColor="#00A6E0" />
            </linearGradient>

            {/* Deep PayPal Blue Shadow Gradient */}
            <linearGradient id="daNavyGrad" x1="6" y1="6" x2="26" y2="30" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#0070BA" />
              <stop offset="100%" stopColor="#001C48" />
            </linearGradient>

            {/* PayPal Gold Radar Beacon */}
            <linearGradient id="daGoldGrad" x1="16" y1="12" x2="28" y2="24" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FFF176" />
              <stop offset="40%" stopColor="#FFC439" />
              <stop offset="100%" stopColor="#F59E0B" />
            </linearGradient>

            <filter id="daGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#00A6E0" floodOpacity="0.4" />
            </filter>
          </defs>

          {/* ── Outer Supersonic Wing: Stylized 'D' Defense Arc ── */}
          <path
            d="M 7 6 C 7 4.9 7.9 4 9 4 L 18 4 C 24.6 4 29 8.4 29 15 C 29 21.6 24.6 26 18 26 L 12 26 L 12 31 C 12 31.6 11.6 32 11 32 L 8 32 C 7.4 32 7 31.6 7 31 Z"
            fill="url(#daNavyGrad)"
          />
          {/* Inner D Counter Sheen */}
          <path
            d="M 12 9 L 17.5 9 C 21.5 9 24 11.4 24 15 C 24 18.6 21.5 21 17.5 21 L 12 21 Z"
            fill="#002566"
            fillOpacity="0.85"
          />

          {/* ── Interlocking Forward 'A' Autopilot Supersonic Delta ── */}
          <path
            d="M 13 32 L 21 10 C 21.3 9.2 22.1 8.8 22.9 9.1 C 23.3 9.2 23.6 9.5 23.8 10 L 30 25 C 30.4 26 29.8 27 28.7 27 L 25.5 27 L 24 23 L 18 23 L 15.5 31.5 C 15.3 32.2 14.6 32.5 13.9 32.3 C 13.3 32.1 12.9 31.5 13 32 Z"
            fill="url(#daWingGrad)"
            filter="url(#daGlow)"
          />

          {/* Inner 'A' Supersonic Delta Window */}
          <polygon
            points="22.5,13.8 19.5,20.5 25.2,20.5"
            fill="#001C48"
            fillOpacity="0.9"
          />

          {/* ── Active Autopilot Beacon / Gold Radar Sensor Core ── */}
          <circle cx="22.5" cy="18.5" r="2.2" fill="url(#daGoldGrad)" />
          <circle cx="22.5" cy="18.5" r="3.2" stroke="#FFC439" strokeWidth="0.8" strokeOpacity="0.6" fill="none" />
          
          {/* Speed Chevron Accent */}
          <path
            d="M 8 15 L 11 15 L 14 18 L 11 21 L 8 21 L 10.5 18 Z"
            fill="url(#daGoldGrad)"
          />
        </svg>
      </div>

      {/* ── Brand Typography ── */}
      {!collapsed && (
        <div className="flex flex-col leading-tight">
          <div className="flex items-center gap-2">
            <span
              className={`${s.title} font-black tracking-tight ${
                isLight ? 'text-white' : 'text-slate-900 group-hover:text-[#003087]'
              } transition-colors flex items-center gap-1`}
            >
              DA
            </span>
            <div className="flex items-center gap-1">
              <span
                className={`text-[8.5px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                  isLight
                    ? 'bg-blue-500/25 text-blue-200 border border-blue-400/40'
                    : 'bg-gradient-to-r from-blue-50 to-indigo-50 text-[#003087] border border-blue-200/90 font-extrabold shadow-xs'
                }`}
              >
                AUTOPILOT
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" title="Autonomous Agent Active" />
            </div>
          </div>

          {showSubtitle && (
            <span
              className={`${s.sub} font-bold tracking-wider uppercase ${
                isLight ? 'text-blue-200/90' : 'text-[#0070BA]'
              }`}
            >
              Dispute Autopilot
            </span>
          )}
        </div>
      )}
    </div>
  );

  if (!href) return content;

  return (
    <Link href={href} className="inline-block outline-none">
      {content}
    </Link>
  );
}
