'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import TopHeader from '@/components/TopHeader';
import CreateAccountModal from '@/components/CreateAccountModal';
import { useUser } from '@/components/UserContext';
import Logo from '@/components/Logo';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const { activeUser, sessionError, loading: userLoading } = useUser();
  const router = useRouter();
  const pathname = usePathname();

  // Robust path normalization ignoring query strings and trailing slashes
  const normalizedPath = (pathname || '').split('?')[0].replace(/\/+$/, '') || '/';
  const isAuthPage = normalizedPath === '/login' || normalizedPath === '/register' || normalizedPath.startsWith('/login') || normalizedPath.startsWith('/register');

  // Restore sidebar state from localStorage on load
  useEffect(() => {
    const saved = localStorage.getItem('sidebar_collapsed');
    if (saved === 'true') setCollapsed(true);
  }, []);

  // API authorization is enforced server-side; redirect unauthenticated users to /login
  useEffect(() => {
    if (!userLoading && !activeUser && !isAuthPage) {
      router.replace('/login');
    }
  }, [userLoading, activeUser, isAuthPage, router]);

  const handleToggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('sidebar_collapsed', String(next));
  };

  // Authentication pages render immediately without sidebar shell or protected gate
  if (isAuthPage) {
    return <main className="w-full h-full min-h-screen bg-white">{children}</main>;
  }

  // Branded enterprise software loading screen
  if (userLoading) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-gradient-to-br from-[#001433] via-[#001C48] to-[#003087] text-white p-6 relative overflow-hidden select-none">
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-[#0070BA]/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-96 h-96 rounded-full bg-[#00C4FF]/15 blur-3xl pointer-events-none" />

        <div className="flex flex-col items-center space-y-5 relative z-10 animate-enter-up">
          <Logo variant="light" size="xl" href="/login" />
          <div className="flex flex-col items-center space-y-2 text-center pt-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span className="text-xs font-bold uppercase tracking-widest text-sky-200">
                Dispute Autopilot (DA)
              </span>
            </div>
            <p className="text-sm font-semibold text-white/80">
              Connecting to secure PayPal merchant session…
            </p>
          </div>
          <div className="w-48 h-1.5 bg-white/10 rounded-full overflow-hidden relative">
            <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-sky-400 via-blue-500 to-amber-300 rounded-full w-1/2 animate-shimmer" />
          </div>
        </div>
      </div>
    );
  }

  // Redirecting unauthenticated user
  if (!activeUser) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-gradient-to-br from-[#001433] via-[#001C48] to-[#003087] text-white p-6 relative overflow-hidden select-none">
        <div className="flex flex-col items-center space-y-4 relative z-10 animate-enter-up">
          <Logo variant="light" size="xl" href="/login" />
          <p className="text-xs font-semibold text-sky-200">
            Redirecting to sign-in…
          </p>
          <div className="w-36 h-1 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-sky-400 rounded-full w-2/3 animate-shimmer" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex overflow-hidden w-full bg-[#F4F6F8] relative">
      {/* ── Ambient PayPal Canvas Backdrop Mesh & Reflection Grid ── */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        {/* Soft PayPal Navy Ambient Radar Cone */}
        <div className="absolute -top-32 -left-32 w-[600px] h-[600px] rounded-full bg-gradient-to-br from-[#003087]/8 via-[#0070BA]/4 to-transparent blur-3xl pointer-events-none" />
        {/* Sky Blue & Cyan Center Glow */}
        <div className="absolute top-1/3 -right-24 w-[550px] h-[550px] rounded-full bg-gradient-to-bl from-[#00A6E0]/7 via-[#38BDF8]/4 to-transparent blur-3xl pointer-events-none" />
        {/* PayPal Gold Subtle Bottom Horizon Reflection */}
        <div className="absolute -bottom-32 left-1/4 w-[700px] h-[450px] rounded-full bg-gradient-to-tr from-[#FFC439]/6 via-[#0070BA]/3 to-transparent blur-3xl pointer-events-none" />
        {/* Fine Precision Canvas Micro-Dot Grid */}
        <div 
          className="absolute inset-0 opacity-[0.40]"
          style={{
            backgroundImage: 'radial-gradient(rgba(0, 48, 135, 0.12) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />
      </div>

      {/* Floating Left Sidebar Container */}
      <div className="p-3 pr-1 flex shrink-0 h-full relative z-10">
        <Sidebar collapsed={collapsed} onToggleCollapse={handleToggle} />
      </div>

      {/* Main App Container */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-transparent relative z-10 transition-all duration-300">
        <TopHeader onToggleSidebar={handleToggle} />
        <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-2 pb-6 custom-scrollbar">
          <div className="max-w-[1600px] mx-auto">
            {sessionError && <p role="alert" className="mb-4 text-sm text-rose-700">{sessionError}</p>}
            {children}
          </div>
        </main>
      </div>

      {/* Global Account Creation Modal */}
      <CreateAccountModal />
    </div>
  );
}

