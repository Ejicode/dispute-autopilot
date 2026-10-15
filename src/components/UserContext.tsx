'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { UserAccount } from '@/lib/types';

export const CURATED_AVATARS = [
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=256&q=80',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=256&q=80',
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=256&q=80',
  'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=256&q=80',
  'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=256&q=80',
];

type Registration = { name: string; email: string; password: string; store_name: string; avatar_url?: string };
type AuthResult = { success: boolean; error?: string };
interface UserContextType {
  users: UserAccount[];
  activeUser: UserAccount | null;
  loading: boolean;
  sessionError: string | null;
  isCreateModalOpen: boolean;
  refreshUsers: () => Promise<void>;
  openCreateModal: () => void;
  closeCreateModal: () => void;
  logout: () => Promise<void>;
  login: (email: string, password: string) => Promise<AuthResult>;
  createAccount: (data: Registration) => Promise<AuthResult>;
}
const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [activeUser, setActiveUser] = useState<UserAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const revision = useRef(0);

  const refreshUsers = useCallback(async () => {
    const current = ++revision.current;
    try {
      const response = await fetch('/api/auth', { cache: 'no-store' });
      if (current !== revision.current) return;
      if (response.status === 401) { setActiveUser(null); return; }
      if (!response.ok) throw new Error('Unable to check your session.');
      const data = await response.json();
      if (current === revision.current) { setActiveUser(data.user); setSessionError(null); }
    } catch {
      if (current === revision.current) setSessionError('Unable to check your session. Please try again.');
    } finally { if (current === revision.current) setLoading(false); }
  }, []);

  useEffect(() => {
    void refreshUsers();
    const sync = () => { void refreshUsers(); };
    const storage = (event: StorageEvent) => { if (event.key === 'session-changed') sync(); };
    window.addEventListener('focus', sync);
    window.addEventListener('storage', storage);
    const timer = setInterval(sync, 60000);
    return () => { clearInterval(timer); window.removeEventListener('focus', sync); window.removeEventListener('storage', storage); };
  }, [refreshUsers]);

  const notifyTabs = () => {
    // Identity is never stored here; this only tells other tabs to re-check their cookie.
    try { localStorage.removeItem('active_user_id'); localStorage.setItem('session-changed', String(Date.now())); } catch {}
  };

  const authenticate = async (url: string, data: unknown): Promise<AuthResult> => {
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const result = await response.json();
      if (!response.ok) return { success: false, error: result.error || 'Unable to sign in.' };
      ++revision.current;
      setActiveUser(result.user);
      setLoading(false);
      setSessionError(null);
      setIsCreateModalOpen(false);
      notifyTabs();
      return { success: true };
    } catch { return { success: false, error: 'Connection failed. Please try again.' }; }
  };

  const logout = async () => {
    try {
      const response = await fetch('/api/auth', { method: 'DELETE' });
      if (!response.ok) throw new Error();
      ++revision.current;
      setActiveUser(null);
      setLoading(false);
      setSessionError(null);
      setIsCreateModalOpen(false);
      notifyTabs();
    } catch { setSessionError('Sign-out failed. Please try again.'); }
  };

  return <UserContext.Provider value={{
    users: activeUser ? [activeUser] : [], activeUser, loading, sessionError, isCreateModalOpen,
    refreshUsers, openCreateModal: () => setIsCreateModalOpen(true), closeCreateModal: () => setIsCreateModalOpen(false),
    logout, login: (email, password) => authenticate('/api/auth/login', { email, password }),
    createAccount: data => authenticate('/api/auth', data),
  }}>{children}</UserContext.Provider>;
}

export function useUser() {
  const context = useContext(UserContext);
  if (!context) throw new Error('useUser must be used within a UserProvider');
  return context;
}
