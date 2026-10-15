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
      <div className="min-h-screen bg-[#EDF2F7] flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="w-10 h-10 animate-spin text-[#0070BA] mx-auto" />
          <p className="text-slate-500 text-sm font-medium">Loading Dispute Autopilot…</p>
        </div>
      </div>
    );
  }

  // Keep protected content unmounted while redirecting to sign-in.
  if (!activeUser) {
    return (
      <div className="min-h-screen bg-[#EDF2F7] flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-[#0070BA] mx-auto" />
      </div>
    );
  }

  return (
    <div className="h-full flex overflow-hidden w-full">
      {/* Adjustable Left Sidebar */}
      <Sidebar collapsed={collapsed} onToggleCollapse={handleToggle} />

      {/* Main App Container */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[#EDF2F7] transition-all duration-300">
        <TopHeader onToggleSidebar={handleToggle} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">
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

