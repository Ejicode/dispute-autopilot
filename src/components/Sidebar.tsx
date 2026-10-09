'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  UserCheck, 
  FolderArchive, 
  ShieldAlert, 
  BarChart3, 
  ChevronLeft, 
  ChevronRight,
  Zap,
  FileText,
  ShieldCheck,
  LogOut,
  Power
} from 'lucide-react';
import Logo from './Logo';
import { useRealtime } from './RealtimeContext';
import { useUser } from './UserContext';

interface SidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onSimulateDispute?: () => void;
}

export default function Sidebar({
  collapsed = false,
  onToggleCollapse,
  onSimulateDispute,
}: SidebarProps) {
  const pathname = usePathname();
  const { isConnected } = useRealtime();
  const { activeUser, logout, openCreateModal } = useUser();

  const avatarUrl =
    activeUser?.avatar_url ||
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=256&q=80';

  const navItems = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/case/dsp_hero_1240', label: 'Case Detail', icon: FileText, matchPrefix: '/case' },
    { href: '/storefront', label: 'Storefront', icon: FolderArchive },
    { href: '/trust-lab', label: 'Trust Lab', icon: ShieldAlert },
    { href: '/bench', label: 'Dispute Bench', icon: BarChart3 },
    { href: '/profile', label: 'Profile', icon: UserCheck },
  ];

  const handleLogout = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirm('Switch or log out of this merchant session?')) {
      logout();
    }
  };

  return (
    <aside
      className={`bg-[#0B0F19] text-white flex flex-col justify-between shrink-0 min-h-screen border-r border-slate-900 z-30 select-none transition-all duration-300 ease-in-out ${
        collapsed ? 'w-20 p-3' : 'w-64 p-5'
      }`}
    >
      <div>
        {/* ── Top Header: Logo + Collapse Button (Clean, No Profile Here) ── */}
        <div className={`flex items-center pb-6 pt-1 ${collapsed ? 'justify-center' : 'justify-between px-2'}`}>
          <Logo collapsed={collapsed} />

          {/* Side Panel Adjust / Collapse Toggle Button */}
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="p-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-400 hover:text-white transition-colors"
              title={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            >
              {collapsed ? (
                <ChevronRight className="w-4 h-4 text-[#0070BA]" />
              ) : (
                <ChevronLeft className="w-4 h-4 text-slate-400" />
              )}
            </button>
          )}
        </div>

        {/* ── Navigation Menu ── */}
        <nav className="space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.matchPrefix
              ? pathname.startsWith(item.matchPrefix)
              : pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`w-full flex items-center rounded-2xl transition-all duration-200 group relative ${
                  collapsed ? 'justify-center p-3' : 'gap-3.5 px-4 py-3 text-xs font-bold'
                } ${
                  isActive
                    ? 'bg-[#0070BA] text-white shadow-lg shadow-blue-800/40'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
                }`}
                title={collapsed ? item.label : undefined}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-white'}`} />
                {!collapsed && <span>{item.label}</span>}

                {/* Floating Tooltip when collapsed */}
                {collapsed && (
                  <span className="absolute left-full ml-3 px-2.5 py-1 rounded-xl bg-slate-900 text-white text-xs font-semibold whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-50 shadow-md border border-slate-800">
                    {item.label}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* ── Bottom Area: Status, Action & User Profile Picture with Logout ── */}
      <div className="pt-4 border-t border-slate-800/80 space-y-3">
        {/* Real-time SSE Connection Status */}
        <div
          className={`rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center transition-all ${
            collapsed ? 'justify-center p-2' : 'justify-between px-3 py-2 text-xs'
          }`}
          title={isConnected ? 'Connected to live SSE stream' : 'Reconnecting...'}
        >
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
            {!collapsed && (
              <span className="text-slate-300 font-medium">
                {isConnected ? 'Live SSE Stream' : 'Connecting...'}
              </span>
            )}
          </div>
          {!collapsed && (
            <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded-full">
              Active
            </span>
          )}
        </div>

        {/* Primary Action Button (PayPal Blue) */}
        <button
          onClick={onSimulateDispute}
          className={`w-full rounded-2xl bg-[#0070BA] hover:bg-[#003087] text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center transition-all shadow-lg shadow-blue-800/30 hover:scale-[1.02] active:scale-[0.98] ${
            collapsed ? 'p-3' : 'py-3 px-4 gap-2'
          }`}
          title="Simulate Inbound Dispute"
        >
          <Zap className="w-3.5 h-3.5 text-[#FFC439] fill-[#FFC439] shrink-0" />
          {!collapsed && <span>Simulate Dispute</span>}
        </button>

        {/* ── Profile Picture Down By the Logout Side ── */}
        {collapsed ? (
          /* Collapsed View: Picture Icon at bottom with Logout */
          <div className="flex flex-col items-center gap-2 pt-2 border-t border-slate-800/60">
            <Link
              href="/profile"
              className="relative group block rounded-full"
              title={`${activeUser?.name || 'Merchant'} - Profile`}
            >
              <div className="w-10 h-10 rounded-full overflow-hidden ring-2 ring-[#0070BA] hover:ring-white transition-all shadow-md">
                <img src={avatarUrl} alt={activeUser?.name} className="w-full h-full object-cover" />
              </div>
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-[#0B0F19]" />
            </Link>

            <button
              onClick={handleLogout}
              className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-white/[0.05] transition-colors"
              title="Logout / Switch Merchant"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          /* Expanded View: Profile Card with Picture, Name, Store & Logout Button */
          <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-between gap-2.5">
            <Link href="/profile" className="flex items-center gap-2.5 min-w-0 flex-1 group" title="View Merchant Profile">
              <div className="relative shrink-0">
                <div className="w-10 h-10 rounded-full overflow-hidden ring-2 ring-[#0070BA] group-hover:ring-[#FFC439] transition-all shadow-sm">
                  <img src={avatarUrl} alt={activeUser?.name} className="w-full h-full object-cover" />
                </div>
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-[#0B0F19]" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="font-bold text-xs text-white truncate group-hover:text-sky-300 transition-colors flex items-center gap-1">
                  <span>{activeUser?.name || 'Merchant'}</span>
                  <ShieldCheck className="w-3 h-3 text-[#FFC439] shrink-0" />
                </div>
                <span className="text-[10px] text-slate-400 block truncate">
                  {activeUser?.store_name || 'Your Store'}
                </span>
                <span className="text-[9px] text-[#009CDE] font-bold block mt-0.5 group-hover:underline">
                  View Profile →
                </span>
              </div>
            </Link>

            {/* Logout / Switch Button */}
            <button
              onClick={handleLogout}
              className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0"
              title="Logout / Switch Merchant"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
