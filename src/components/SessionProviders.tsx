'use client';

import { UserProvider, useUser } from './UserContext';
import { RealtimeProvider } from './RealtimeContext';
import AppShell from './AppShell';
import AiAssistant from './AiAssistant';
import { isDemoBuyer } from '@/lib/persona';

function Workspace({ children }: { children: React.ReactNode }) {
  const { activeUser } = useUser();
  // Discard queries, chat history, notifications, and streams on identity changes.
  return <RealtimeProvider key={activeUser?.id || 'anonymous'}>
    <AppShell>{children}</AppShell>
    {/* Ava is the merchant's assistant: it reads merchant data and runs merchant actions. */}
    {activeUser && !isDemoBuyer(activeUser) && <AiAssistant />}
  </RealtimeProvider>;
}

export default function SessionProviders({ children }: { children: React.ReactNode }) {
  return <UserProvider><Workspace>{children}</Workspace></UserProvider>;
}
