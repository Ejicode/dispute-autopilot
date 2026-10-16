import { NextResponse } from 'next/server';
import { withMerchant } from '@/lib/auth/session';
import { merchantScope } from '@/lib/auth/context';

export const dynamic = 'force-dynamic';
export const GET = withMerchant(async () => {
  const { mode } = merchantScope();
  return NextResponse.json({ mode, simulation_enabled: mode === 'demo', provider_environment: mode === 'demo' ? null : mode });
});
