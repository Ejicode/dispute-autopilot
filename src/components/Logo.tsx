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
      {/* ── Geometric Pine Vault Shield Emblem ── */}
      <div
        className={`${s.box} bg-gradient-to-br from-[#06291B] via-[#0A3E29] to-[#041F14] flex items-center justify-center shrink-0 relative overflow-hidden shadow-sm border border-emerald-500/25 group-hover:shadow-md group-hover:border-emerald-400/50 transition-all duration-300`}
        style={{
          boxShadow: isLight
            ? '0 4px 14px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.2)'
            : '0 4px 12px rgba(10,62,41,0.22), inset 0 1px 0 rgba(255,255,255,0.3)',
        }}
      >
        {/* Specular Gloss Highlight */}
        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-white/20 pointer-events-none" />

        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`${s.icon} relative z-10 transition-transform duration-300 group-hover:scale-105`}
        >
          <defs>
            <linearGradient id="pinenGrad1" x1="16" y1="3" x2="16" y2="29" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#6EE7B7" />
              <stop offset="45%" stopColor="#10B981" />
              <stop offset="100%" stopColor="#059669" />
            </linearGradient>
            <linearGradient id="pinenGradCore" x1="12" y1="9" x2="20" y2="22" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#A7F3D0" />
              <stop offset="100%" stopColor="#34D399" />
            </linearGradient>
          </defs>

          {/* Tier 1 & 2 & 3 Evergreen Pine Silhouette */}
          <path
            d="M16 3.5L22.5 11.5H18.5L24 18H18L21.5 23H10.5L14 18H8L13.5 11.5H9.5L16 3.5Z"
            fill="url(#pinenGrad1)"
          />

          {/* Central Faceted Core & Vault Shield Accents */}
          <path
            d="M16 8.5L19.2 12.5H17.2L20.2 17H16.8L18 21H14L15.2 17H11.8L14.8 12.5H12.8L16 8.5Z"
            fill="url(#pinenGradCore)"
            fillOpacity="0.85"
          />

          {/* Sturdy Trunk Foundation */}
          <rect
            x="14.25"
            y="23"
            width="3.5"
            height="5.5"
            rx="1"
            fill="#34D399"
          />

          {/* Cryptographic Node Dot */}
          <circle cx="16" cy="14" r="1.5" fill="#FFFFFF" />
        </svg>
      </div>

      {/* ── Brand Typography ── */}
      {!collapsed && (
        <div className="flex flex-col leading-tight">
          <div className="flex items-center gap-1.5">
            <span
              className={`${s.title} font-black tracking-tight ${
                isLight ? 'text-white' : 'text-slate-900 group-hover:text-[#0A3E29]'
              } transition-colors`}
            >
              PinenMFB
            </span>
            <span
              className={`text-[8.5px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${
                isLight
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
                  : 'bg-emerald-50 text-[#0A3E29] border border-emerald-200'
              }`}
            >
              MFB
            </span>
          </div>

          {showSubtitle && (
            <span
              className={`${s.sub} font-bold tracking-wider uppercase ${
                isLight ? 'text-emerald-300/90' : 'text-emerald-700'
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
