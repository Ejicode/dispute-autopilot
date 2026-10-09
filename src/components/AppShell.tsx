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
  const { activeUser, users, loading: userLoading } = useUser();
  const router = useRouter();
  const pathname = usePathname();

  const isRegisterPage = pathname === '/register';

  // Restore sidebar state from localStorage on load
  useEffect(() => {
    const saved = localStorage.getItem('sidebar_collapsed');
    if (saved === 'true') setCollapsed(true);
  }, []);

  // First-run gate: if no users exist and we're NOT already on /register, redirect there
  useEffect(() => {
    if (!userLoading && users.length === 0 && !isRegisterPage) {
      router.replace('/register');
    }
  }, [userLoading, users, isRegisterPage, router]);

  const handleToggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('sidebar_collapsed', String(next));
  };

  // /register page renders without the sidebar shell (full-page layout)
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

  // While redirecting to /register, render nothing (redirect is in flight)
  if (!userLoading && users.length === 0) {
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
            {children}
          </div>
        </main>
      </div>

      {/* Global Account Creation Modal */}
      <CreateAccountModal />
    </div>
  );
}

