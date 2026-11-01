// Mirrors store.DemoBuyerID in the Go server. In demo mode this seeded buyer
// shops in the demo merchant's workspace, but must never see or act as that
// merchant: no merchant pages, revenue, customer list or assistant.
export const DEMO_BUYER_ID = 'usr_demo_buyer_shopper';

export function isDemoBuyer(user: { id?: string } | null | undefined): boolean {
  return user?.id === DEMO_BUYER_ID;
}
