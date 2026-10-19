// Shared system-event contract consumed by the UI realtime layer.
//
// The hub itself now lives in the Go backend (internal/realtime); this module
// only serves as the single source of truth for the event type on the client.

export interface SystemEvent {
  type:
    | 'ORDER_CAPTURED'
    | 'VAULT_ITEM_ADDED'
    | 'DISPUTE_OPENED'
    | 'DISPUTE_RECONCILED'
    | 'CARRIER_UPDATE'
    | 'DRAFT_GENERATED'
    | 'CLAIM_VERIFIED'
    | 'ACTION_APPROVED'
    | 'PAYPAL_API_RESOLVED'
    | 'ATTACK_BLOCKED'
    | 'BENCHMARK_PROGRESS'
    | 'USER_REGISTERED';
  payload: any;
  timestamp: string;
}
