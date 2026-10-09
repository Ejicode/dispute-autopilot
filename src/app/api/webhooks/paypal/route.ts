import { NextRequest, NextResponse } from 'next/server';
import { processPayPalWebhook } from '@/lib/paypal/webhooks';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const headers = {
      authAlgo: req.headers.get('paypal-auth-algo') || undefined,
      certUrl: req.headers.get('paypal-cert-url') || undefined,
      transmissionId: req.headers.get('paypal-transmission-id') || undefined,
      transmissionSig: req.headers.get('paypal-transmission-sig') || undefined,
      transmissionTime: req.headers.get('paypal-transmission-time') || undefined,
    };

    const body = await req.json();
    const result = await processPayPalWebhook(headers, body);

    return NextResponse.json(
      { status: result.status, message: result.message, disputeId: result.disputeId },
      { status: result.statusCode }
    );
  } catch (err: any) {
    console.error('Webhook error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
