import { NextResponse } from 'next/server';
import { HttpError, withMerchant } from '@/lib/auth/session';
import { readAuthBody } from '@/lib/auth/validation';
import { requireDispute } from '@/lib/approvals/service';
import { reconciliationHistory, reconcileDispute } from '@/lib/approvals/reconciliation';

export const dynamic = 'force-dynamic';
export const GET = withMerchant(async (_req,{params}) => NextResponse.json(reconciliationHistory(params.id)));
export const POST = withMerchant(async (req,{params}) => {
  requireDispute(params.id);
  const body=await readAuthBody(req);
  if (Object.keys(body).length) throw new HttpError(400,'Reconciliation accepts an empty object; provider state cannot be supplied by the client.');
  const result=await reconcileDispute(params.id);
  return NextResponse.json(result.body,{status:result.status});
});
