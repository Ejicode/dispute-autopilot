'use client';

import { useEffect, useState } from 'react';

export type AppMode = 'demo' | 'sandbox' | 'live';
export type Provenance = 'DEMO' | 'PAYPAL_SANDBOX' | 'PAYPAL_LIVE' | 'UNKNOWN';

/** Short user-facing label for each mode. Demo never claims a PayPal connection. */
export const MODE_LABEL: Record<AppMode, string> = {
  demo: 'Demo mode · simulated PayPal',
  sandbox: 'PayPal Sandbox',
  live: 'PayPal Live',
};

let pending: Promise<AppMode | null> | null = null;

// The server owns the mode (APP_MODE); a static export cannot read it at build
// time, so ask once per page load and share the answer.
function fetchMode(): Promise<AppMode | null> {
  if (!pending) {
    pending = fetch('/api/runtime')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const mode = data?.mode;
        return mode === 'demo' || mode === 'sandbox' || mode === 'live' ? mode : null;
      })
      .catch(() => null)
      .then((mode) => {
        if (mode === null) pending = null; // retry on the next mount
        return mode;
      });
  }
  return pending;
}

/** The server's application mode, or null until known (or when signed out). */
export function useAppMode(): AppMode | null {
  const [mode, setMode] = useState<AppMode | null>(null);
  useEffect(() => {
    let active = true;
    fetchMode().then((value) => {
      if (active) setMode(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return mode;
}
