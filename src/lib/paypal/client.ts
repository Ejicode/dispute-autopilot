import { requireMatchingProvenance } from '../runtime/safety';
import crypto from 'crypto';
import { Dispute, ExactActionSnapshot } from '../types';
import { getDb, recordAuditLog } from '../db';
import { merchantScope } from '../auth/context';
import { HttpError } from '../auth/session';

export interface PayPalCredentials {
  clientId?: string;
  clientSecret?: string;
  environment?: 'sandbox' | 'live';
}

export class PayPalClient {
  private baseUrl: string;
  private environment: string;
  private clientId: string;
  private clientSecret: string;
  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor() {
    this.clientId = process.env.PAYPAL_CLIENT_ID || '';
    this.clientSecret = process.env.PAYPAL_CLIENT_SECRET || '';
    const env = process.env.PAYPAL_ENVIRONMENT || 'sandbox';
    this.environment = env;
    this.baseUrl = env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  }

  public isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  public assertMerchantAccess(): void {
    const scope = merchantScope();
    if (scope.mode === 'demo') return; // Demo ignores credentials and never uses the transport.
    if (!this.isConfigured()) throw new HttpError(503, 'PayPal credentials are required in operational modes.');
    if (this.environment !== scope.mode) throw new HttpError(503, 'PAYPAL_ENVIRONMENT must match APP_MODE.');
    if (scope.merchantId !== process.env.PAYPAL_MERCHANT_USER_ID) {
      throw new HttpError(403, 'PayPal is not connected to this merchant workspace.');
    }
  }

  private assertAction(disputeId: string, action: ExactActionSnapshot): void {
    this.assertMerchantAccess();
    if (action.environment !== merchantScope().mode) throw new HttpError(422, 'Reviewed action belongs to a different environment.');
    const dispute = getDb().prepare('SELECT * FROM disputes WHERE id=?').get(disputeId) as Dispute | undefined;
    if (!dispute || action.dispute_id !== disputeId || action.paypal_dispute_id !== dispute.paypal_dispute_id) throw new HttpError(422, 'Reviewed dispute identity does not match.');
    requireMatchingProvenance(dispute);
    for (const id of action.evidence_ids) {
      const evidence = getDb().prepare('SELECT provenance,dispute_id,order_id FROM evidence_items WHERE id=?').get(id) as {provenance:string;dispute_id:string;order_id:string}|undefined;
      if (!evidence || (evidence.dispute_id !== dispute.id && (!dispute.order_id || evidence.order_id !== dispute.order_id))) throw new HttpError(422, 'Reviewed evidence is unavailable.');
      requireMatchingProvenance(evidence);
    }
  }

  /**
   * Obtain OAuth 2.0 access token with in-memory caching
   */
  public async getAccessToken(): Promise<string> {
    this.assertMerchantAccess();
    if (merchantScope().mode === 'demo') throw new HttpError(503, 'Demo mode does not request PayPal access tokens.');

    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 60000) {
      return this.cachedToken.token;
    }

    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`PayPal OAuth failed (${res.status}): ${errText}`);
    }

    const data = await res.json();
    this.cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    };

    return this.cachedToken.token;
  }

  /**
   * Submit dispute evidence to PayPal Disputes API
   */
  public async provideEvidence(
    disputeId: string,
    action: ExactActionSnapshot,
    idempotencyKey: string
  ): Promise<{ success: boolean; result: any }> {
    if (action.action_type !== 'PROVIDE_EVIDENCE' || !action.provider_payload) throw new Error('A reviewed evidence request is required.');
    const payload = action.provider_payload;
    const requestBody = JSON.stringify(payload);
    this.assertAction(disputeId, action);

    if (merchantScope().mode === 'demo') {
      // Explicit offline demo adapter.
      recordAuditLog(
        'paypal',
        'PAYPAL_API_PROVIDE_EVIDENCE_MOCK',
        {
          dispute_id: disputeId,
          idempotency_key: idempotencyKey,
          payload,
          status: 'SUCCESS',
        },
        disputeId
      );

      return {
        success: true,
        result: {
          dispute_id: disputeId,
          status: 'UNDER_REVIEW',
          acknowledged_at: new Date().toISOString(),
          idempotency_key: idempotencyKey,
          simulation: true,
        },
      };
    }

    const token = await this.getAccessToken();
    const res = await fetch(`${this.baseUrl}/v1/customer/disputes/${action.paypal_dispute_id}/provide-evidence`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': idempotencyKey,
      },
      body: requestBody,
      signal: AbortSignal.timeout(30000),
    });

    const resText = await res.text();
    let resJson;
    try {
      resJson = JSON.parse(resText);
    } catch {
      resJson = { raw: resText };
    }

    recordAuditLog(
      'paypal',
      'PAYPAL_API_PROVIDE_EVIDENCE',
      {
        dispute_id: disputeId,
        http_status: res.status,
        idempotency_key: idempotencyKey,
        response: resJson,
      },
      disputeId
    );

    if (!res.ok) {
      throw new Error(`PayPal API provide-evidence failed (${res.status}): ${resText}`);
    }

    return { success: true, result: resJson };
  }

  /**
   * Accept buyer claim and refund
   */
  public async acceptClaim(
    disputeId: string,
    action: ExactActionSnapshot,
    idempotencyKey: string
  ): Promise<{ success: boolean; result: any }> {
    if (action.action_type !== 'ACCEPT_CLAIM' || !action.provider_payload) throw new Error('A reviewed acceptance request is required.');
    const requestBody = JSON.stringify(action.provider_payload);
    this.assertAction(disputeId, action);

    if (merchantScope().mode === 'demo') {
      recordAuditLog(
        'paypal',
        'PAYPAL_API_ACCEPT_CLAIM_MOCK',
        {
          dispute_id: disputeId,
          idempotency_key: idempotencyKey,
          notes: action.notes,
        },
        disputeId
      );

      return {
        success: true,
        result: {
          dispute_id: disputeId,
          status: 'UNDER_REVIEW',
          simulation: true,
        },
      };
    }

    const token = await this.getAccessToken();
    const res = await fetch(`${this.baseUrl}/v1/customer/disputes/${action.paypal_dispute_id}/accept-claim`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': idempotencyKey,
      },
      body: requestBody,
      signal: AbortSignal.timeout(30000),
    });

    const resText = await res.text();
    let resJson;
    try {
      resJson = JSON.parse(resText);
    } catch {
      resJson = { raw: resText };
    }

    recordAuditLog(
      'paypal',
      'PAYPAL_API_ACCEPT_CLAIM',
      {
        dispute_id: disputeId,
        http_status: res.status,
        idempotency_key: idempotencyKey,
        response: resJson,
      },
      disputeId
    );

    if (!res.ok) {
      throw new Error(`PayPal API accept-claim failed (${res.status}): ${resText}`);
    }

    return { success: true, result: resJson };
  }

  /**
   * Verify Webhook Signature via PayPal API
   */
  public async verifyWebhookSignature(params: {
    authAlgo: string;
    certUrl: string;
    transmissionId: string;
    transmissionSig: string;
    transmissionTime: string;
    webhookId: string;
    webhookEvent: Record<string, any>;
  }): Promise<boolean> {
    if (merchantScope().mode === 'demo' || !this.isConfigured()) {
      return false;
    }

    if (!params.webhookId) return false;

    const token = await this.getAccessToken();
    const res = await fetch(`${this.baseUrl}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_algo: params.authAlgo,
        cert_url: params.certUrl,
        transmission_id: params.transmissionId,
        transmission_sig: params.transmissionSig,
        transmission_time: params.transmissionTime,
        webhook_id: params.webhookId,
        webhook_event: params.webhookEvent,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      throw new Error(`PayPal webhook verification unavailable (${res.status}).`);
    }

    const data = await res.json();
    return data.verification_status === 'SUCCESS';
  }
}

export const paypalClient = new PayPalClient();
