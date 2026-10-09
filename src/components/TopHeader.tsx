'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { 
  Search, 
  Bell, 
  ChevronDown, 
  Check, 
  ShieldCheck, 
  Menu,
  UserCheck,
  PlusCircle,
  ExternalLink,
  LogOut
} from 'lucide-react';
import { useRealtime } from './RealtimeContext';
import { useUser } from './UserContext';
import SearchBar from './SearchBar';

interface TopHeaderProps {
  onSearch?: (query: string) => void;
  onToggleSidebar?: () => void;
  metrics?: {
    totalAtRiskCents: number;
    expiring48hCount: number;
  };
}

export default function TopHeader({ onSearch, onToggleSidebar, metrics }: TopHeaderProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const { notifications } = useRealtime();
  const { users, activeUser, setActiveUser, openCreateModal, logout } = useUser();


  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    if (onSearch) onSearch(e.target.value);
  };

  const avatarUrl = activeUser?.avatar_url || 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=256&q=80';

  return (
    <header className="bg-gradient-to-r from-[#003087] via-[#0070BA] to-[#0086CE] text-white px-5 py-3 shadow-md flex items-center justify-between gap-4 z-20">
      {/* ── Left Side: Mobile Menu Toggle & Brand Context ── */}
      <div className="flex items-center gap-3 shrink-0">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="p-2 rounded-xl hover:bg-white/10 text-white/90 transition-colors md:hidden"
            title="Toggle Navigation"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        {/* Active Store Shield Badge */}
        <div className="hidden xl:flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 border border-white/20 text-xs font-semibold backdrop-blur-sm">
          <ShieldCheck className="w-3.5 h-3.5 text-[#FFC439]" />
          <span className="text-white/90 truncate max-w-[140px]">{activeUser?.store_name || 'Protected Store'}</span>
          <span className="text-[10px] bg-emerald-500/25 text-emerald-200 font-bold px-1.5 py-0.2 rounded-full">
            PROTECTED
          </span>
        </div>
      </div>

      {/* ── Center: Live Search Bar ── */}
      <div className="flex-1 flex justify-center max-w-xl mx-auto px-2">
        <SearchBar />
      </div>

      {/* ── Right Side: Quick Action Icons & Profile Pill with Photo ── */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Quick Metrics Badge */}
        {metrics && (
          <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/15 border border-white/20 text-white text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-[#FFC439] animate-pulse" />
            <span>${(metrics.totalAtRiskCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
            <span className="text-white/75 font-normal">at risk</span>
          </div>
        )}

        {/* Notifications Bell */}
        <div className="flex items-center">
          <button 
            className="p-2 rounded-full hover:bg-white/10 text-white/90 hover:text-white transition-colors relative"
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
            {notifications.length > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#FFC439] ring-2 ring-[#0070BA]" />
            )}
          </button>
        </div>

        {/* User Account Profile Pill with Picture Photo */}
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2.5 pl-2.5 py-1 pr-1.5 rounded-full bg-white/10 hover:bg-white/20 cursor-pointer transition-colors border border-white/25 select-none shadow-sm"
          >
            <div className="text-left hidden sm:block">
              <span className="text-xs font-bold tracking-wide uppercase text-white block leading-tight truncate max-w-[120px]">
                {activeUser?.name || 'Merchant'}
              </span>
              <span className="text-[10px] text-white/75 block leading-none truncate max-w-[120px]">
                {activeUser?.store_name || 'Your Store'}
              </span>
            </div>
            
            {/* Circular Picture Avatar with Status Indicator */}
            <div className="relative w-8 h-8 rounded-full overflow-hidden ring-2 ring-white/70 shadow-sm shrink-0 bg-white/20">
              <img
                src={avatarUrl}
                alt={activeUser?.name || 'User'}
                className="w-full h-full object-cover"
              />
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-1 ring-white" />
            </div>

            <ChevronDown className="w-3.5 h-3.5 text-white/80" />
          </button>

          {/* Profile & Account Switcher Dropdown */}
          {dropdownOpen && (
            <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-slate-100 p-3 text-slate-800 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
              {/* Active Profile Info */}
              <div className="p-3 bg-gradient-to-br from-slate-50 to-blue-50/40 rounded-xl border border-slate-100 mb-2 flex items-center gap-3">
                <img
                  src={avatarUrl}
                  alt={activeUser?.name || 'User'}
                  className="w-11 h-11 rounded-full object-cover ring-2 ring-[#0070BA]/30 shadow-sm shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm text-slate-900 truncate flex items-center gap-1">
                    <span>{activeUser?.name}</span>
                    <ShieldCheck className="w-3.5 h-3.5 text-[#0070BA]" />
                  </div>
                  <span className="text-xs text-slate-500 font-medium block truncate">
                    {activeUser?.store_name}
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono block truncate">
                    {activeUser?.email}
                  </span>
                </div>
              </div>

              {/* Direct Link to Profile */}
              <Link
                href="/profile"
                onClick={() => setDropdownOpen(false)}
                className="w-full flex items-center justify-between px-3 py-2.5 mb-2 rounded-xl bg-blue-50/80 hover:bg-blue-100/80 text-[#0070BA] font-bold text-xs transition-colors border border-blue-200/50"
              >
                <div className="flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-[#0070BA]" />
                  <span>View Profile &amp; Credentials</span>
                </div>
                <ExternalLink className="w-3.5 h-3.5 opacity-70" />
              </Link>

              {/* Registered Accounts List */}
              <div className="py-1 max-h-48 overflow-y-auto space-y-1">
                <span className="px-2 text-[10px] font-bold uppercase text-slate-400 block mb-1">
                  Switch Merchant Profile ({users.length})
                </span>
                {users.map((u) => {
                  const isCurrent = activeUser?.id === u.id;
                  const uAvatar = u.avatar_url || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=256&q=80';
                  return (
                    <button
                      key={u.id}
                      onClick={() => {
                        setActiveUser(u);
                        setDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-between p-2 rounded-xl text-left text-xs transition-colors ${
                        isCurrent
                          ? 'bg-blue-50 text-[#0070BA] font-bold'
                          : 'hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <img
                          src={uAvatar}
                          alt={u.name}
                          className="w-7 h-7 rounded-full object-cover shrink-0 ring-1 ring-slate-200"
                        />
                        <div className="min-w-0">
                          <span className="block font-semibold truncate">{u.name}</span>
                          <span className="text-[10px] text-slate-400 block truncate">{u.store_name}</span>
                        </div>
                      </div>
                      {isCurrent && <Check className="w-4 h-4 text-[#0070BA] shrink-0" />}
                    </button>
                  );
                })}
              </div>

              {/* Create Account & Logout Action Buttons */}
              <div className="pt-2 border-t border-slate-100 mt-1 flex items-center gap-2">
                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    openCreateModal();
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-[#0070BA] hover:bg-[#003087] text-white text-xs font-bold transition-all shadow-md shadow-blue-800/20"
                >
                  <PlusCircle className="w-3.5 h-3.5 text-[#FFC439]" />
                  <span>New Merchant</span>
                </button>
                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    logout();
                  }}
                  className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 transition-colors"
                  title="Log Out Session"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
