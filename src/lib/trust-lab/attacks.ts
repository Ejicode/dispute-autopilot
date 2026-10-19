// Shared Trust Lab result contract. The attack suite itself is implemented in
// the Go backend (internal/trustlab); this module only carries the UI type.

export interface AttackResult {
  id: string;
  name: string;
  attack_type: string;
  payload: any;
  blocked: boolean;
  http_status: number;
  audit_ref: string;
  reason: string;
  run_date: string;
}
