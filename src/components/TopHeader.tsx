'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Search,
  Mail,
  ChevronDown,
  ShieldCheck,
  ArrowUpRight,
  Menu,
  UserCheck,
  LogOut,
  X,
  ShoppingBag,
} from 'lucide-react';
import { useUser } from './UserContext';
import { isDemoBuyer } from '@/lib/persona';
import { useRealtime } from './RealtimeContext';
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

export default function TopHeader({ title = 'Dispute Queue', onToggleSidebar }: TopHeaderProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  // Inbox of this session's live events; unread only when something new arrived.
  const { recent } = useRealtime();
  const [lastSeenId, setLastSeenId] = useState<string | null>(null);
  const hasUnread = recent.length > 0 && recent[0].id !== lastSeenId;
  const { activeUser, logout } = useUser();
  const isBuyer = isDemoBuyer(activeUser);
  const pathname = usePathname() || '';
  const isStorefront = pathname.startsWith('/storefront');

  const notificationsRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Without an uploaded avatar, show the initial (as the profile page does), not a stranger's photo.
  const avatarUrl = activeUser?.avatar_url || null;
  const initial = (activeUser?.name || 'M').trim().charAt(0).toUpperCase();
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
          <div className="flex items-center">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight leading-none">
              {title}
            </h1>
          </div>
          <p className="text-xs font-semibold text-slate-400 mt-1">
            {formattedDate}
          </p>
        </div>
      </div>

      {/* ── Center / In-Place Search Bar (Desktop/Tablet); merchant data, so not for the buyer ── */}
      {!isBuyer ? (
        <div className="hidden md:block flex-1 max-w-xs sm:max-w-sm md:max-w-md mx-2 sm:mx-4">
          <SearchBar variant="light" placeholder="Search disputes, orders…" />
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* ── Right Side: Mail Envelope & User Profile Pill ── */}
      <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">

        {/* Quick Persona Switcher (merchant only: the buyer has no merchant console) */}
        {isBuyer ? null : isStorefront ? (
          <Link
            href="/"
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#003087] hover:bg-[#001C48] text-white text-xs font-bold transition-all shadow-sm"
            title="Switch to Merchant Operations Console"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Merchant Console</span>
          </Link>
        ) : (
          <Link
            href="/storefront?mode=buyer"
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold transition-all card-3d-reflection"
            title="Open the buyer storefront"
          >
            <ShoppingBag className="w-3.5 h-3.5 text-[#0070BA]" />
            <span>Buyer Store</span>
          </Link>
        )}

        {/* Circular Mail / Envelope Button with Popover */}
        <div ref={notificationsRef} className="relative">
          <button 
            type="button"
            onClick={() => {
              setNotificationsOpen((prev) => !prev);
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
            <div 
              style={{ position: 'absolute' }}
              className="absolute right-0 top-full mt-2.5 w-80 sm:w-96 bg-white/95 backdrop-blur-xl p-4 rounded-3xl shadow-2xl shadow-slate-900/15 z-50 border border-slate-200 animate-in fade-in slide-in-from-top-2 duration-150 text-left"
            >
              <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-900">Messages &amp; Alerts</span>
                  {hasUnread && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-100 text-rose-700">
                      Live
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setNotificationsOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="space-y-2 max-h-72 overflow-y-auto pr-0.5">
                {recent.length === 0 ? (
                  <p className="p-3 text-xs text-slate-500 leading-relaxed">
                    No events yet this session. Purchases, disputes, carrier updates and Trust Lab runs appear here as they happen.
                  </p>
                ) : (
                  recent.map((n) => (
                    <div key={n.id} className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs space-y-1">
                      <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        <span>{n.type.replace(/_/g, ' ')}</span>
                        <span className="font-mono normal-case tracking-normal">
                          {new Date(n.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-slate-700 font-medium leading-snug">{n.message}</p>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setLastSeenId(recent[0]?.id ?? null);
                  }}
                  className="text-xs font-bold text-[#0070BA] hover:underline cursor-pointer"
                >
                  Mark all as read
                </button>
                <Link
                  href="/vault"
                  onClick={() => setNotificationsOpen(false)}
                  className="text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1"
                >
                  <span>Evidence Vault</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* User Account Profile Pill */}
        <div ref={dropdownRef} className="relative">
          <button
            type="button"
            onClick={() => {
              setDropdownOpen((prev) => !prev);
              if (notificationsOpen) setNotificationsOpen(false);
            }}
            className="flex items-center gap-2.5 pl-1.5 pr-3 py-1 rounded-full bg-white card-3d-reflection hover:-translate-y-0.5 cursor-pointer transition-all select-none"
          >
            {/* Circular Picture Avatar */}
            <div className="relative w-8 h-8 rounded-full overflow-hidden ring-1 ring-slate-200 shadow-sm shrink-0">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={activeUser?.name || 'Merchant Admin'}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="w-full h-full flex items-center justify-center bg-blue-50 text-[#003087] text-sm font-black">
                  {initial}
                </span>
              )}
              <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-emerald-500 ring-1 ring-white" />
            </div>

            <div className="text-left hidden sm:block">
              <span className="text-xs font-bold text-slate-900 block leading-tight truncate max-w-[120px]">
                {activeUser?.name || 'Merchant Admin'}
              </span>
              <span className="text-[10px] text-slate-400 block leading-none truncate max-w-[120px]">
                {isBuyer ? 'Demo buyer' : 'Merchant admin'}
              </span>
            </div>

            <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          </button>

          {/* Profile Switcher Dropdown */}
          {dropdownOpen && (
            <div 
              style={{ position: 'absolute' }}
              className="absolute right-0 top-full mt-2.5 w-72 bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl shadow-slate-900/15 border border-slate-200 p-3 text-slate-800 z-50 animate-in fade-in slide-in-from-top-2 duration-150 text-left"
            >
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 mb-2 flex items-center gap-3">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={activeUser?.name || 'Merchant Admin'}
                    className="w-10 h-10 rounded-full object-cover ring-2 ring-[#003087]/30 shadow-sm shrink-0"
                  />
                ) : (
                  <span className="w-10 h-10 rounded-full flex items-center justify-center bg-blue-50 text-[#003087] text-base font-black ring-2 ring-[#003087]/30 shadow-sm shrink-0">
                    {initial}
                  </span>
                )}
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
