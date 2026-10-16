import { applicationMode } from '@/lib/runtime/mode';
import { NextRequest, NextResponse } from 'next/server';
import { processPayPalWebhook } from '@/lib/paypal/webhooks';
import { paypalClient } from '@/lib/paypal/client';
import { withMerchantScope } from '@/lib/auth/context';
import { authDb } from '@/lib/auth/store';
import { PUBLIC_ACCOUNT_FIELDS, routeError } from '@/lib/auth/session';
import { readAuthBody } from '@/lib/auth/validation';
import type { UserAccount } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    if (applicationMode() === 'demo') return NextResponse.json({error:'PayPal webhooks are disabled in demo mode.'},{status:503});
    // Provider webhooks have no browser session. Only server configuration selects their owner.
    const ownerId = process.env.PAYPAL_MERCHANT_USER_ID;
    if (!paypalClient.isConfigured() || !process.env.PAYPAL_WEBHOOK_ID || !ownerId) {
      return NextResponse.json({ error: 'PayPal webhook integration is not configured.' }, { status: 503 });
    }
    const owner = authDb().prepare(`SELECT ${PUBLIC_ACCOUNT_FIELDS} FROM accounts WHERE id = ?`).get(ownerId) as UserAccount | undefined;
    if (!owner) return NextResponse.json({ error: 'PayPal merchant is not configured.' }, { status: 503 });
    const headers = {
      authAlgo: req.headers.get('paypal-auth-algo') || undefined,
      certUrl: req.headers.get('paypal-cert-url') || undefined,
      transmissionId: req.headers.get('paypal-transmission-id') || undefined,
      transmissionSig: req.headers.get('paypal-transmission-sig') || undefined,
      transmissionTime: req.headers.get('paypal-transmission-time') || undefined,
    };

    const body = await readAuthBody(req,256 * 1024);
    const result = await withMerchantScope(owner.id, () => { paypalClient.assertMerchantAccess(); return processPayPalWebhook(headers, body); }, owner);

    return NextResponse.json(
      { status: result.status, message: result.message, disputeId: result.disputeId },
      { status: result.statusCode, headers: { 'Cache-Control':'no-store', ...(result.statusCode===503 ? {'Retry-After':'30'} : {}) } }
    );
  } catch (err) { return routeError(err); }
}
