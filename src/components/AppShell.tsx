'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import TopHeader from '@/components/TopHeader';
import CreateAccountModal from '@/components/CreateAccountModal';
import { useUser } from '@/components/UserContext';
import { Loader2 } from 'lucide-react';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const { activeUser, sessionError, loading: userLoading } = useUser();
  const router = useRouter();
  const pathname = usePathname();

  const isRegisterPage = pathname === '/register' || pathname === '/login';

  // Restore sidebar state from localStorage on load
  useEffect(() => {
    const saved = localStorage.getItem('sidebar_collapsed');
    if (saved === 'true') setCollapsed(true);
  }, []);

  // API authorization is enforced server-side; this gate provides the sign-in UI.
  useEffect(() => {
    if (!userLoading && !activeUser && !isRegisterPage) {
      router.replace('/login');
    }
  }, [userLoading, activeUser, isRegisterPage, router]);

  const handleToggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('sidebar_collapsed', String(next));
  };

  // Authentication pages render without the sidebar shell.
  if (isRegisterPage) {
    return <>{children}</>;
  }

  // Show loading spinner while determining user session
  if (userLoading) {
    return (
      <div className="min-h-screen bg-[#F4F6F8] flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="w-10 h-10 animate-spin text-[#003087] mx-auto" />
          <p className="text-slate-500 text-sm font-medium">Loading Dispute Autopilot…</p>
        </div>
      </div>
    );
  }

  // Keep protected content unmounted while redirecting to sign-in.
  if (!activeUser) {
    return (
      <div className="min-h-screen bg-[#F4F6F8] flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-[#003087] mx-auto" />
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

