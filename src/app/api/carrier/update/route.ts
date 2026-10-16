import { requireDemo } from '@/lib/runtime/safety';
import { HttpError, withMerchant } from '@/lib/auth/session';
import { readAuthBody, field } from '@/lib/auth/validation';
import { NextRequest, NextResponse } from 'next/server';
import { advanceCarrierStatus, CarrierMilestone } from '@/lib/carrier/simulator';

export const dynamic = 'force-dynamic';

async function handlePOST(req: NextRequest) {
  requireDemo();
  const body = await readAuthBody(req);
  const orderId = field(body, 'order_id', 100);
  if (body.target_status !== undefined && !['LABEL_CREATED','PICKED_UP','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED'].includes(body.target_status as string)) {
    throw new HttpError(400, 'Invalid target_status');
  }
  return NextResponse.json(await advanceCarrierStatus(orderId, body.target_status as CarrierMilestone['status'] | undefined));
}

export const POST = withMerchant(handlePOST);
