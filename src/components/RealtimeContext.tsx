'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import type { SystemEvent } from '@/lib/realtime/hub';

import { useUser } from './UserContext';

export interface RealtimeNotification {
  id: string;
  message: string;
  type: string;
  timestamp: string;
}

interface RealtimeContextValue {
  isConnected: boolean;
  lastEvent: SystemEvent | null;
  /** Toast queue: each entry dismisses itself after a few seconds. */
  notifications: RealtimeNotification[];
  /** The last 20 events of this session, newest first, for the inbox. */
  recent: RealtimeNotification[];
  dismissNotification: (id: string) => void;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  isConnected: false,
  lastEvent: null,
  notifications: [],
  recent: [],
  dismissNotification: () => {},
});

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { activeUser } = useUser();
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<SystemEvent | null>(null);
  const [notifications, setNotifications] = useState<RealtimeNotification[]>([]);
  const [recent, setRecent] = useState<RealtimeNotification[]>([]);

  const dismissNotification = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  useEffect(() => {
    if (!activeUser) return;
    let eventSource: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout;

    function connect() {
      eventSource = new EventSource('/api/events/stream');

      eventSource.onopen = () => {
        setIsConnected(true);
      };

      eventSource.onmessage = (e) => {
        try {
          const data: SystemEvent = JSON.parse(e.data);
          if ((data as any).type === 'CONNECTED') {
            setIsConnected(true);
            return;
          }

          setLastEvent(data);

          // Add to notifications queue
          const notifId = 'notif_' + Math.random().toString(36).substring(2, 9);
          let message = `Event: ${data.type}`;

          if (data.type === 'ORDER_CAPTURED') {
            message = `Payment Captured: ${data.payload.order_number} ($${(data.payload.total_cents / 100).toFixed(2)}) → Evidence Vaulted`;
          } else if (data.type === 'VAULT_ITEM_ADDED') {
            message = `Vault Item Added: ${data.payload.title} (SHA-256 Verified)`;
          } else if (data.type === 'DISPUTE_OPENED') {
            message = `Inbound Dispute: ${data.payload.paypal_dispute_id} ($${(data.payload.amount_cents / 100).toFixed(2)}) - Score: ${data.payload.strength_score}`;
          } else if (data.type === 'CARRIER_UPDATE') {
            message = `Carrier Transit: ${data.payload.tracking_number} status updated to ${data.payload.delivery_status}`;
          } else if (data.type === 'CLAIM_VERIFIED') {
            message = data.payload.verified ? `Claim Verifier: All claims verified against Vault` : `Claim Verifier: UNVERIFIED CLAIMS DETECTED`;
          } else if (data.type === 'ACTION_APPROVED') {
            message = `Approved Action Sent to PayPal: ${data.payload.dispute?.paypal_dispute_id}`;
          } else if (data.type === 'ATTACK_BLOCKED') {
            const results: { blocked?: boolean }[] = Array.isArray(data.payload) ? data.payload : [];
            const blocked = results.filter((r) => r.blocked).length;
            message = blocked === results.length
              ? `Trust Lab: all ${results.length} attacks blocked`
              : `Trust Lab: ${results.length - blocked} of ${results.length} attacks NOT blocked`;
          }

          const entry = { id: notifId, message, type: data.type, timestamp: data.timestamp };
          setNotifications((prev) => [entry, ...prev.slice(0, 4)]);
          setRecent((prev) => [entry, ...prev.slice(0, 19)]);

          // Auto dismiss after 6 seconds
          setTimeout(() => {
            dismissNotification(notifId);
          }, 6000);
        } catch {}
      };

      eventSource.onerror = () => {
        setIsConnected(false);
        eventSource?.close();
        reconnectTimeout = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      eventSource?.close();
      clearTimeout(reconnectTimeout);
    };
  }, [activeUser?.id]);

  return (
    <RealtimeContext.Provider value={{ isConnected, lastEvent, notifications, recent, dismissNotification }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  return useContext(RealtimeContext);
}
