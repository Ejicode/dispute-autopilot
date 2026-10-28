'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  Home, 
  Shield, 
  Tag, 
  ShieldAlert, 
  Activity, 
  Settings, 
  ShieldCheck,
  FileCheck,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  LogOut
} from 'lucide-react';
import Logo from './Logo';
import { useUser } from './UserContext';

interface SidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onSimulateDispute?: () => void;
}

export default function Sidebar({
  collapsed = false,
  onToggleCollapse,
}: SidebarProps) {
  const pathname = usePathname();
  const { logout } = useUser();

  const menuSections = [
    {
      title: 'PLATFORM',
      items: [
        { href: '/', label: 'Dispute Queue', icon: Home, exact: true },
        { href: '/case/dsp_hero_1240', label: 'Case Review', icon: Shield, matchPrefix: '/case' },
        { href: '/storefront', label: 'Sales & Orders', icon: Tag },
        { href: '/vault', label: 'Evidence Vault', icon: FileCheck },
      ],
    },
    {
      title: 'SECURITY & DEFENSE',
      items: [
        { href: '/trust-lab', label: 'Trust Lab (Attacks)', icon: ShieldAlert },
        { href: '/bench', label: 'Dispute Bench', icon: Activity },
      ],
    },
    {
      title: 'SETTINGS',
      items: [
        { href: '/profile', label: 'Merchant Profile', icon: Settings },
      ],
    },
  ];

  return (
    <aside
      className={`card-3d-reflection text-slate-800 flex flex-col justify-between shrink-0 h-full rounded-[28px] z-30 select-none transition-all duration-300 ease-in-out ${
        collapsed ? 'w-20 p-3' : 'w-64 p-5'
      }`}
    >
      <div className="space-y-5 overflow-y-auto custom-scrollbar pr-1">
        {/* ── Top Header: Logo + Collapse Button ── */}
        <div className={`flex items-center pb-3 pt-1 border-b border-slate-100/80 ${collapsed ? 'justify-center' : 'justify-between px-1'}`}>
          <Logo collapsed={collapsed} size={collapsed ? 'md' : 'lg'} />

          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors"
              title={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            >
              {collapsed ? (
                <ChevronRight className="w-4 h-4 text-[#003087]" />
              ) : (
                <ChevronLeft className="w-4 h-4 text-slate-500" />
              )}
            </button>
          )}
        </div>

        {/* ── Navigation Menu Grouped By Sections ── */}
        <nav className="space-y-4">
          {menuSections.map((section) => (
            <div key={section.title} className="space-y-1">
              {!collapsed && (
                <div className="px-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  {section.title}
                </div>
              )}
              {collapsed && (
                <div className="w-6 h-px bg-slate-200 mx-auto my-1.5" />
              )}
              <div className="space-y-1">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  // Make 'Report' (href: '/') active when on home page
                  const isActive = item.exact
                    ? pathname === item.href
                    : item.matchPrefix
                    ? pathname.startsWith(item.matchPrefix)
                    : pathname === item.href;

                  const className = `w-full flex items-center rounded-2xl transition-all duration-200 group relative ${
                    collapsed ? 'justify-center p-3' : 'gap-3 px-3.5 py-2.5 text-xs font-semibold'
                  } ${
                    isActive
                      ? 'bg-[#003087] text-white shadow-sm font-bold shadow-blue-950/20'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                  }`;

                  const content = (
                    <>
                      <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-900'}`} />
                      {!collapsed && <span>{item.label}</span>}

                      {/* Tooltip when collapsed */}
                      {collapsed && (
                        <span className="absolute left-full ml-3 px-2.5 py-1 rounded-xl bg-slate-900 text-white text-xs font-semibold whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-50 shadow-md border border-slate-800">
                          {item.label}
                        </span>
                      )}
                    </>
                  );

                  return item.href.startsWith('/case/') ? (
                    <a key={item.label} href={item.href} className={className} title={collapsed ? item.label : undefined}>
                      {content}
                    </a>
                  ) : (
                    <Link key={item.label} href={item.href} className={className} title={collapsed ? item.label : undefined}>
                      {content}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* ── Bottom Card: Invariant Defense Guard Telemetry ── */}
      <div className="pt-2">
        {!collapsed ? (
          <div className="bg-gradient-to-br from-[#001C48] via-[#003087] to-[#001433] text-white p-4 rounded-3xl shadow-md space-y-3 relative overflow-hidden border border-blue-400/25">
            <div className="flex items-center justify-between">
              <div className="w-7 h-7 rounded-xl bg-blue-500/20 text-blue-300 flex items-center justify-center border border-blue-400/30">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
              </div>
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-400/15 text-emerald-300 border border-emerald-400/20">
                ACTIVE
              </span>
            </div>

            <div>
              <h4 className="text-xs font-bold text-white leading-tight">Invariant Defense Guard</h4>
              <p className="text-[10px] text-blue-100/70 mt-1 leading-snug">
                6/6 penetration attacks blocked • SHA-256 vault active
              </p>
            </div>

            <div className="pt-0.5">
              <Link
                href="/trust-lab"
                className="w-full py-2 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-center text-xs font-bold text-white flex items-center justify-center gap-1.5 transition-all shadow-inner"
              >
                <span>Run Trust Lab Suite</span>
                <ArrowUpRight className="w-3.5 h-3.5 text-blue-200" />
              </Link>
            </div>

            <div className="pt-1 text-center border-t border-white/10">
              <span className="text-[9px] font-bold text-blue-200/75 tracking-wider uppercase block">
                PayPal REST APIs • Gemini AI
              </span>
            </div>
          </div>
        ) : (
          <button
            onClick={() => {
              if (confirm('Log out of session?')) logout();
            }}
            className="w-full p-2.5 rounded-2xl bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-500 flex items-center justify-center transition-all"
            title="Log Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        )}
      </div>
    </aside>
  );
}
