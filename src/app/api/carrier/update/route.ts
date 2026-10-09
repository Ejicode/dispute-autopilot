import { NextRequest, NextResponse } from 'next/server';
import { advanceCarrierStatus } from '@/lib/carrier/simulator';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { order_id, target_status } = body;

    if (!order_id) {
      return NextResponse.json({ error: 'order_id is required' }, { status: 400 });
    }

    const result = await advanceCarrierStatus(order_id, target_status);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
