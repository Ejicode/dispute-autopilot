export type AppMode = 'demo' | 'sandbox' | 'live';
export type Provenance = 'DEMO' | 'PAYPAL_SANDBOX' | 'PAYPAL_LIVE' | 'UNKNOWN';

/** Missing configuration is offline demo, never an implicit provider connection. */
export function applicationMode(): AppMode {
  const mode = process.env.APP_MODE ?? 'demo';
  if (mode !== 'demo' && mode !== 'sandbox' && mode !== 'live') throw new Error('APP_MODE must be demo, sandbox, or live.');
  return mode;
}
export function provenanceFor(mode: AppMode): Provenance {
  return mode === 'demo' ? 'DEMO' : mode === 'sandbox' ? 'PAYPAL_SANDBOX' : 'PAYPAL_LIVE';
}
