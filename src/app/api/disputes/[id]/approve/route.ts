import { NextRequest, NextResponse } from 'next/server';
import { HttpError, withMerchant } from '@/lib/auth/session';
import { readAuthBody } from '@/lib/auth/validation';
import { executeApproval, parseAction, requireDispute, reviewAction } from '@/lib/approvals/service';

export const dynamic = 'force-dynamic';
export const GET = withMerchant(async (req: NextRequest, { params }) => {
  requireDispute(params.id);
  return NextResponse.json(reviewAction(params.id, parseAction(req.nextUrl.searchParams.get('action_type'))));
});
export const POST = withMerchant(async (req: NextRequest, { params }) => {
  requireDispute(params.id);
  const body = await readAuthBody(req);
  const action = parseAction(body.action_type);
  if (Object.keys(body).some(key => !['action_type','snapshot_digest'].includes(key))) throw new HttpError(400, 'Only action_type and snapshot_digest are accepted.');
  if (typeof body.snapshot_digest !== 'string' || !/^[a-f0-9]{64}$/.test(body.snapshot_digest)) throw new HttpError(400, 'A reviewed snapshot_digest is required.');
  const result = await executeApproval(params.id, action, body.snapshot_digest);
  return NextResponse.json(result.body, { status: result.status });
});
