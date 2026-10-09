export type DisputeReason =
  | 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED'
  | 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED'
  | 'UNAUTHORISED'
  | 'INCORRECT_AMOUNT'
  | 'DUPLICATE_TRANSACTION'
  | 'BUYER_CANCELLED_SERVICE'
  | 'OTHER';

export type DisputeStatus =
  | 'REQUIRED_ACTION'
  | 'UNDER_REVIEW'
  | 'RESOLVED'
  | 'CLOSED'
  | 'APPEALED';

export type TriageRecommendation = 'FIGHT' | 'ACCEPT' | 'ASK A HUMAN';

export interface Dispute {
  id: string;
  paypal_dispute_id: string;
  transaction_id: string;
  order_id: string | null;
  reason: DisputeReason;
  amount_cents: number;
  currency: string;
  status: DisputeStatus;
  response_deadline: string;
  outcome: string | null;
  strength_score: number;
  recommendation: TriageRecommendation;
  created_at: string;
  updated_at: string;
}

export type EvidenceType =
  | 'PROOF_OF_DELIVERY'
  | 'TRACKING_HISTORY'
  | 'ORDER_CONFIRMATION'
  | 'CUSTOMER_COMMUNICATION'
  | 'REFUND_POLICY'
  | 'DEVICE_FINGERPRINT';

export interface EvidenceItem {
  id: string;
  dispute_id: string | null;
  order_id: string | null;
  evidence_type: EvidenceType;
  source: string;
  title: string;
  content: string; // JSON or plaintext details
  file_path: string | null;
  sha256_hash: string;
  captured_at: string;
}

export interface Claim {
  claim_id: string;
  text: string;
  claim_type: 'TRACKING_NUMBER' | 'SHIPPING_DATE' | 'DELIVERY_DATE' | 'DELIVERY_ADDRESS' | 'TRANSACTION_AMOUNT' | 'BUYER_NAME';
  expected_value: string;
  evidence_id: string;
  verified?: boolean;
  mismatch_reason?: string;
}

export interface AIDraft {
  id: string;
  dispute_id: string;
  classification: string;
  draft_text: string;
  claims: Claim[];
  schema_valid: boolean;
  model_name: string;
  verified: boolean;
  verification_errors?: string[];
  created_at: string;
}

export interface ExactActionSnapshot {
  action_type: 'PROVIDE_EVIDENCE' | 'ACCEPT_CLAIM';
  dispute_id: string;
  paypal_dispute_id: string;
  amount_cents: number;
  currency: string;
  evidence_ids: string[];
  notes: string;
  timestamp: string;
}

export interface Approval {
  id: string;
  draft_id: string;
  dispute_id: string;
  approver: string;
  exact_action_snapshot: ExactActionSnapshot;
  decision: 'APPROVED' | 'REJECTED';
  idempotency_key: string;
  executed_at: string | null;
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  dispute_id: string | null;
  actor: 'system' | 'ai' | 'user' | 'paypal';
  action: string;
  detail: Record<string, any>;
  sha256_hash: string;
  created_at: string;
}

export interface DemoOrder {
  id: string;
  order_number: string;
  buyer_name: string;
  buyer_email: string;
  shipping_address: string;
  items: Array<{
    name: string;
    quantity: number;
    unit_price_cents: number;
    sku: string;
  }>;
  total_cents: number;
  currency: string;
  paypal_order_id: string | null;
  carrier: string;
  tracking_number: string;
  delivery_status: 'LABEL_CREATED' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED';
  delivered_at: string | null;
  created_at: string;
}

export interface PayPalWebhookEvent {
  id: string;
  event_version: string;
  create_time: string;
  resource_type: string;
  event_type: string;
  summary: string;
  resource: Record<string, any>;
  links: any[];
}

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  store_name: string;
  role: string;
  avatar_url?: string;
  created_at: string;
}

