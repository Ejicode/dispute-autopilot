'use client';

import React from 'react';
import Link from 'next/link';

interface LogoProps {
  collapsed?: boolean;
}

export default function Logo({ collapsed = false }: LogoProps) {
  return (
    <Link href="/" className="flex items-center gap-3 group select-none">
      {/* Official Enterprise PayPal AI Shield Emblem */}
      <div className="relative w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#003087] via-[#0070BA] to-[#009CDE] flex items-center justify-center shadow-lg shadow-blue-900/30 group-hover:scale-105 transition-all duration-200 shrink-0">
        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-5 h-5 text-white drop-shadow-sm"
        >
          {/* Shield Outline */}
          <path
            d="M16 3L6 7V14C6 20.5 10.3 26.6 16 29C21.7 26.6 26 20.5 26 14V7L16 3Z"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* PayPal Style 'P' Vector inside Shield */}
          <path
            d="M13 10H17.5C19 10 20.2 11.2 20.2 12.7C20.2 14.2 19 15.4 17.5 15.4H14.5L13.8 21H12L13 10Z"
            fill="#FFC439"
          />
          <path
            d="M15 13H18.5C19.7 13 20.7 14 20.7 15.2C20.7 16.4 19.7 17.4 18.5 17.4H16.2L15.6 22H13.8L15 13Z"
            fill="white"
            fillOpacity="0.85"
          />
        </svg>

        {/* Small gold sparkle indicator */}
        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#FFC439] ring-2 ring-[#0B0F19]" />
      </div>

      {/* Brand Text (Hidden when sidebar is collapsed) */}
      {!collapsed && (
        <div className="overflow-hidden transition-opacity duration-200">
          <div className="flex items-center gap-1.5">
            <span className="font-extrabold text-[15px] tracking-tight text-white">DisputeAI</span>
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#FFC439]/20 text-[#FFC439] border border-[#FFC439]/30">
              PayPal AI
            </span>
          </div>
          <span className="text-[10px] text-slate-400 font-medium block tracking-tight">Agentic Defense Autopilot</span>
        </div>
      )}
    </Link>
  );
}
