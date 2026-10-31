'use client';

import { useEffect, useState } from 'react';
import { useRealtime } from '@/components/RealtimeContext';

export interface LatestAttackResult {
  name: string;
  blocked: boolean;
  httpStatus: number;
  runDate: string;
}

interface AttackRunRow {
  attack_name: string;
  blocked: number;
  http_status: number;
  run_date: string;
}

/**
 * The most recent persisted result of each Trust Lab attack, newest run first.
 * Returns null while loading, and an empty list when the suite has never run,
 * so callers can say "not run yet" instead of claiming a result.
 */
export function useLatestTrustLabResults(): LatestAttackResult[] | null {
  const { lastEvent } = useRealtime();
  const [results, setResults] = useState<LatestAttackResult[] | null>(null);
  const refreshKey = lastEvent?.type === 'ATTACK_BLOCKED' ? lastEvent.timestamp : null;

  useEffect(() => {
    let active = true;
    fetch('/api/trust-lab/run')
      .then((res) => (res.ok ? res.json() : { runs: [] }))
      .then((data: { runs?: AttackRunRow[] }) => {
        const latest = new Map<string, LatestAttackResult>();
        for (const run of data.runs ?? []) {
          if (!latest.has(run.attack_name)) {
            latest.set(run.attack_name, {
              name: run.attack_name,
              blocked: Boolean(run.blocked),
              httpStatus: run.http_status,
              runDate: run.run_date,
            });
          }
        }
        if (active) setResults([...latest.values()]);
      })
      .catch(() => {
        if (active) setResults([]);
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  return results;
}
