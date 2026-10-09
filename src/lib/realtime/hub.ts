import { EventEmitter } from 'events';

export interface SystemEvent {
  type:
    | 'ORDER_CAPTURED'
    | 'VAULT_ITEM_ADDED'
    | 'DISPUTE_OPENED'
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


class RealtimeHub extends EventEmitter {
  private static instance: RealtimeHub;

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  public static getInstance(): RealtimeHub {
    if (!RealtimeHub.instance) {
      RealtimeHub.instance = new RealtimeHub();
    }
    return RealtimeHub.instance;
  }

  public publish(type: SystemEvent['type'], payload: any) {
    const event: SystemEvent = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };
    this.emit('system_event', event);
  }
}

export const realtimeHub = RealtimeHub.getInstance();
