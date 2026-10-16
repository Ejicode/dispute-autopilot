import { requireDemo } from '@/lib/runtime/safety';
import { getDb } from '@/lib/db';
import { withMerchant } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import { advanceCarrierStatus } from '@/lib/carrier/simulator';

export const dynamic = 'force-dynamic';

async function handlePOST(req: NextRequest) {
  requireDemo();
  try {
    const body = await req.json();
    const { order_id, target_status } = body;

    if (!order_id) {
      return NextResponse.json({ error: 'order_id is required' }, { status: 400 });
    }

    if (!getDb().prepare('SELECT id FROM demo_orders WHERE id = ?').get(order_id)) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const result = await advanceCarrierStatus(order_id, target_status);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export const POST = withMerchant(handlePOST);
