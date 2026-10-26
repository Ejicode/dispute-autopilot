'use client';

import React from 'react';
import Link from 'next/link';

interface LogoProps {
  collapsed?: boolean;
  variant?: 'dark' | 'light';
  size?: 'sm' | 'md' | 'lg';
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
    sm: { box: 'w-8 h-8 rounded-xl', icon: 'w-4 h-4', title: 'text-sm', sub: 'text-[8px]' },
    md: { box: 'w-10 h-10 rounded-2xl', icon: 'w-5 h-5', title: 'text-[17px]', sub: 'text-[9.5px]' },
    lg: { box: 'w-12 h-12 rounded-2xl', icon: 'w-6 h-6', title: 'text-xl', sub: 'text-[10.5px]' },
  };

  const s = sizeMap[size];

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
        {/* Specular Gloss Highlight */}
        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-white/25 pointer-events-none" />

        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`${s.icon} relative z-10 transition-transform duration-300 group-hover:scale-105`}
        >
          <defs>
            <linearGradient id="daGradWing" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="60%" stopColor="#93C5FD" />
              <stop offset="100%" stopColor="#38BDF8" />
            </linearGradient>
            <linearGradient id="daGradAccent" x1="10" y1="10" x2="22" y2="24" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FFC439" />
              <stop offset="100%" stopColor="#F59E0B" />
            </linearGradient>
          </defs>

          {/* Autopilot Supersonic Shield Contour */}
          <path
            d="M16 3.5L25.5 7.5V15.5C25.5 21.5 21.4 26.8 16 28.5C10.6 26.8 6.5 21.5 6.5 15.5V7.5L16 3.5Z"
            stroke="url(#daGradWing)"
            strokeWidth="1.75"
            strokeLinejoin="round"
            fill="none"
          />

          {/* Stylized 'D' Left Wing */}
          <path
            d="M10 11.5V20.5H13.2C15.6 20.5 17 18.8 17 16C17 13.2 15.6 11.5 13.2 11.5H10ZM12 13.3H13C14.4 13.3 15 14.3 15 16C15 17.7 14.4 18.7 13 18.7H12V13.3Z"
            fill="#FFFFFF"
            fillOpacity="0.95"
          />

          {/* Stylized 'A' Apex & Crossbar */}
          <path
            d="M17.5 20.5L20.5 11.5H22.5L25.5 20.5H23.5L22.8 18.2H20.2L19.5 20.5H17.5ZM20.6 16.5H22.4L21.5 13.5L20.6 16.5Z"
            fill="url(#daGradWing)"
          />

          {/* Autopilot Speed Thrust / Core Spark */}
          <circle cx="16" cy="16" r="1.5" fill="url(#daGradAccent)" />
        </svg>
      </div>

      {/* ── Brand Typography ── */}
      {!collapsed && (
        <div className="flex flex-col leading-tight">
          <div className="flex items-center gap-1.5">
            <span
              className={`${s.title} font-black tracking-tight ${
                isLight ? 'text-white' : 'text-slate-900 group-hover:text-[#003087]'
              } transition-colors`}
            >
              DA
            </span>
            <span
              className={`text-[8.5px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${
                isLight
                  ? 'bg-blue-500/20 text-blue-200 border border-blue-400/30'
                  : 'bg-blue-50 text-[#003087] border border-blue-200 font-extrabold'
              }`}
            >
              AUTOPILOT
            </span>
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
