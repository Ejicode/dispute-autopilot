'use client';

import { UserProvider, useUser } from './UserContext';
import { RealtimeProvider } from './RealtimeContext';
import AppShell from './AppShell';
import AiAssistant from './AiAssistant';

function Workspace({ children }: { children: React.ReactNode }) {
  const { activeUser } = useUser();
  // Discard queries, chat history, notifications, and streams on identity changes.
  return <RealtimeProvider key={activeUser?.id || 'anonymous'}>
    <AppShell>{children}</AppShell>
    {activeUser && <AiAssistant />}
  </RealtimeProvider>;
}

export default function SessionProviders({ children }: { children: React.ReactNode }) {
  return <UserProvider><Workspace>{children}</Workspace></UserProvider>;
}
