import { AsyncLocalStorage } from 'node:async_hooks';
import type { UserAccount } from '../types';

interface MerchantScope { merchantId: string; user?: UserAccount }
// Route bundles and development reloads must share the same request context.
const runtime = globalThis as typeof globalThis & { disputeMerchantContext?: AsyncLocalStorage<MerchantScope> };
const context = runtime.disputeMerchantContext ??= new AsyncLocalStorage<MerchantScope>();

export function withMerchantScope<T>(merchantId: string, work: () => T, user?: UserAccount): T {
  if (!/^usr_[a-f0-9]{32}$/.test(merchantId) && merchantId !== 'demo') throw new Error('Invalid merchant workspace');
  return context.run({ merchantId, user }, work);
}

export function merchantScope(): MerchantScope {
  const scope = context.getStore();
  if (!scope) throw new Error('Merchant context is required for business data access');
  return scope;
}
