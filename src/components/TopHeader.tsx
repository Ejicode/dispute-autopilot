'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { 
  Search, 
  Mail, 
  ChevronDown, 
  ShieldCheck, 
  Menu,
  UserCheck,
  LogOut,
  X
} from 'lucide-react';
import { useUser } from './UserContext';
import SearchBar from './SearchBar';

interface TopHeaderProps {
  title?: string;
  onSearch?: (query: string) => void;
  onToggleSidebar?: () => void;
  metrics?: {
    totalAtRiskCents: number;
    expiring48hCount: number;
  };
}

// Helper to format date like "Friday, October 12th 2025"
function formatOrdinalDate(d: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  
  const dayName = days[d.getDay()];
  const monthName = months[d.getMonth()];
  const dayNum = d.getDate();
  const year = d.getFullYear();

  let suffix = 'th';
  if (dayNum % 10 === 1 && dayNum !== 11) suffix = 'st';
  else if (dayNum % 10 === 2 && dayNum !== 12) suffix = 'nd';
  else if (dayNum % 10 === 3 && dayNum !== 13) suffix = 'rd';

  return `${dayName}, ${monthName} ${dayNum}${suffix} ${year}`;
}

export default function TopHeader({ title = 'Sales Report', onToggleSidebar }: TopHeaderProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(true);
  const { activeUser, logout } = useUser();

  const avatarUrl = activeUser?.avatar_url || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=256&q=80';
  const formattedDate = formatOrdinalDate(new Date());

  return (
    <header className="bg-transparent px-4 sm:px-6 pt-3 pb-2 flex items-center justify-between gap-4 z-20">
      {/* ── Left Side: Mobile Menu Toggle + Title & Sub-Date ── */}
      <div className="flex items-center gap-3">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="p-2 rounded-xl bg-white border border-slate-200/90 text-slate-600 hover:text-slate-900 shadow-sm md:hidden"
            title="Toggle Navigation"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight leading-none">
            {title}
          </h1>
          <p className="text-xs font-semibold text-slate-400 mt-1">
            {formattedDate}
          </p>
        </div>
      </div>

      {/* ── Center / In-Place Search Bar ── */}
      <div className="flex-1 max-w-xs sm:max-w-sm md:max-w-md mx-2 sm:mx-4">
        <SearchBar variant="light" placeholder="Search transactions, items, disputes…" />
      </div>

      {/* ── Right Side: Mail Envelope & User Profile Pill ── */}
      <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">

        {/* Circular Mail / Envelope Button with Popover */}
        <div className="relative">
          <button 
            onClick={() => {
              setNotificationsOpen(!notificationsOpen);
              if (dropdownOpen) setDropdownOpen(false);
            }}
            className="w-10 h-10 rounded-full bg-white card-3d-reflection hover:-translate-y-0.5 flex items-center justify-center text-slate-600 hover:text-slate-900 transition-all relative cursor-pointer"
            title="Messages & Notifications"
          >
            <Mail className="w-4 h-4" />
            {hasUnread && (
              <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-rose-500 animate-pulse ring-2 ring-white" />
            )}
          </button>

          {/* Notifications Dropdown Popover */}
          {notificationsOpen && (
            <div className="absolute right-0 top-12 w-80 sm:w-88 bg-white card-3d-reflection p-4 rounded-2xl shadow-2xl z-50 border border-slate-200 animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-900">Notifications &amp; Alerts</span>
                  {hasUnread && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-100 text-rose-700">
                      Live
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setNotificationsOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="space-y-2.5 max-h-64 overflow-y-auto">
                <div className="p-2.5 rounded-xl bg-blue-50/70 border border-blue-100 text-xs space-y-0.5">
                  <div className="flex items-center justify-between font-bold text-[#003087]">
                    <span>Trust Lab Defense Active</span>
                    <span className="text-[10px] text-blue-700">100%</span>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    All 6 penetration threat vectors successfully intercepted by security gates.
                  </p>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-xs space-y-0.5">
                  <div className="flex items-center justify-between font-bold text-slate-800">
                    <span>Evidence Vault Hashed</span>
                    <span className="text-[10px] text-slate-400">SHA-256</span>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Carrier tracking &amp; order receipts cryptographically chained.
                  </p>
                </div>

                <div className="p-2.5 rounded-xl bg-amber-50/70 border border-amber-100 text-xs space-y-0.5">
                  <div className="flex items-center justify-between font-bold text-amber-900">
                    <span>PayPal Sandbox Connected</span>
                    <span className="text-[10px] text-amber-700">Live SSE</span>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Real-time webhook synchronization enabled on orders and disputes.
                  </p>
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                <button
                  onClick={() => {
                    setHasUnread(false);
                    setNotificationsOpen(false);
                  }}
                  className="text-xs font-bold text-[#0070BA] hover:underline"
                >
                  Mark all as read
                </button>
                <Link
                  href="/trust-lab"
                  onClick={() => setNotificationsOpen(false)}
                  className="text-xs font-medium text-slate-500 hover:text-slate-800"
                >
                  View Threat Lab &rarr;
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* User Account Profile Pill */}
        <div className="relative">
          <button
            onClick={() => {
              setDropdownOpen(!dropdownOpen);
              if (notificationsOpen) setNotificationsOpen(false);
            }}
            className="flex items-center gap-2.5 pl-1.5 pr-3 py-1 rounded-full bg-white card-3d-reflection hover:-translate-y-0.5 cursor-pointer transition-all select-none"
          >
            {/* Circular Picture Avatar */}
            <div className="relative w-8 h-8 rounded-full overflow-hidden ring-1 ring-slate-200 shadow-sm shrink-0">
              <img
                src={avatarUrl}
                alt={activeUser?.name || 'Merchant Admin'}
                className="w-full h-full object-cover"
              />
              <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-emerald-500 ring-1 ring-white" />
            </div>

            <div className="text-left hidden sm:block">
              <span className="text-xs font-bold text-slate-900 block leading-tight truncate max-w-[120px]">
                {activeUser?.name || 'Merchant Admin'}
              </span>
              <span className="text-[10px] text-slate-400 block leading-none truncate max-w-[120px]">
                {activeUser?.role === 'admin' ? 'Admin Officer' : (activeUser?.role || 'Admin Officer')}
              </span>
            </div>

            <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          </button>

          {/* Profile Switcher Dropdown */}
          {dropdownOpen && (
            <div className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-2xl border border-slate-200 p-3 text-slate-800 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 mb-2 flex items-center gap-3">
                <img
                  src={avatarUrl}
                  alt={activeUser?.name || 'Merchant Admin'}
                  className="w-10 h-10 rounded-full object-cover ring-2 ring-[#003087]/30 shadow-sm shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm text-slate-900 truncate flex items-center gap-1">
                    <span>{activeUser?.name || 'Merchant Admin'}</span>
                    <ShieldCheck className="w-3.5 h-3.5 text-[#0070BA]" />
                  </div>
                  <span className="text-xs text-slate-500 font-medium block truncate">
                    {activeUser?.store_name || 'DA Store'}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono block truncate">
                    {activeUser?.email || 'admin@disputeautopilot.com'}
                  </span>
                </div>
              </div>

              <Link
                href="/profile"
                onClick={() => setDropdownOpen(false)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors mb-1"
              >
                <UserCheck className="w-4 h-4 text-[#003087]" />
                <span>Manage Profile &amp; Sandbox API</span>
              </Link>

              <button
                onClick={() => {
                  setDropdownOpen(false);
                  logout();
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Log Out of Session</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
