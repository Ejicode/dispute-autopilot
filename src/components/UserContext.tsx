'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserAccount } from '@/lib/types';
import { useRealtime } from './RealtimeContext';

// Photo URLs for the avatar gallery — names/titles come from the merchant's own registration form
export const CURATED_AVATARS = [
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=256&q=80',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=256&q=80',
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=256&q=80',
  'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=256&q=80',
  'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=256&q=80',
];

interface UserContextType {
  users: UserAccount[];
  activeUser: UserAccount | null;
  loading: boolean;
  isCreateModalOpen: boolean;
  setActiveUser: (user: UserAccount) => void;
  refreshUsers: () => Promise<void>;
  openCreateModal: () => void;
  closeCreateModal: () => void;
  logout: () => void;
  createAccount: (data: { name: string; email: string; store_name: string; avatar_url?: string }) => Promise<{ success: boolean; error?: string }>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [activeUser, setActiveUser] = useState<UserAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const { lastEvent } = useRealtime();

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/auth');
      if (res.ok) {
        const data = await res.json();
        const loadedUsers: UserAccount[] = data.users || [];
        setUsers(loadedUsers);

        // Restore active user from localStorage or pick the first available
        const savedId = typeof window !== 'undefined' ? localStorage.getItem('active_user_id') : null;
        let selected = loadedUsers.find((u) => u.id === savedId);
        if (!selected && loadedUsers.length > 0) {
          selected = loadedUsers[0];
        }
        if (selected) {
          setActiveUser(selected);
          if (typeof window !== 'undefined') {
            localStorage.setItem('active_user_id', selected.id);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load user accounts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // Sync on real-time USER_REGISTERED event
  useEffect(() => {
    if ((lastEvent as any)?.type === 'USER_REGISTERED') {
      fetchUsers();
    }
  }, [lastEvent]);

  const handleSelectUser = (user: UserAccount) => {
    setActiveUser(user);
    if (typeof window !== 'undefined') {
      localStorage.setItem('active_user_id', user.id);
    }
  };

  const logout = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('active_user_id');
    }
    // Switch to alternate user if available or clear
    if (users.length > 1) {
      const alternate = users.find((u) => u.id !== activeUser?.id) || users[0];
      setActiveUser(alternate);
      if (typeof window !== 'undefined') {
        localStorage.setItem('active_user_id', alternate.id);
      }
    } else if (users.length > 0) {
      setActiveUser(users[0]);
    }
  };

  const createAccount = async (data: { name: string; email: string; store_name: string; avatar_url?: string }) => {
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (res.ok && result.user) {
        await fetchUsers();
        handleSelectUser(result.user);
        setIsCreateModalOpen(false);
        return { success: true };
      }
      return { success: false, error: result.error || 'Failed to create account.' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error.' };
    }
  };

  return (
    <UserContext.Provider
      value={{
        users,
        activeUser,
        loading,
        isCreateModalOpen,
        setActiveUser: handleSelectUser,
        refreshUsers: fetchUsers,
        openCreateModal: () => setIsCreateModalOpen(true),
        closeCreateModal: () => setIsCreateModalOpen(false),
        logout,
        createAccount,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}
