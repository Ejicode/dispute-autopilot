import crypto from 'node:crypto';
import type { PayPalWebhookEvent } from '../types';

export class InvalidEvent extends Error {}
export class MissingDependency extends Error {}

export function object(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(value)) throw new InvalidEvent(`Invalid ${label}.`);
  return value;
}

export function timestamp(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new InvalidEvent('A valid provider timestamp is required.');
  }
  return Date.parse(value);
}

export function validateEnvelope(value: unknown): PayPalWebhookEvent {
  if (!object(value)) throw new InvalidEvent('Webhook must be an object.');
  identifier(value.id,'event ID');
  if (typeof value.event_type !== 'string' || !/^[A-Z0-9_.-]{1,150}$/.test(value.event_type)) throw new InvalidEvent('Invalid event type.');
  if (typeof value.resource_type !== 'string' || value.resource_type.length > 100 || !value.resource_type) throw new InvalidEvent('Invalid resource type.');
  timestamp(value.create_time);
  if (!object(value.resource)) throw new InvalidEvent('Webhook resource must be an object.');
  return value as PayPalWebhookEvent;
}

// Stable hashes tolerate object-key order changes in redeliveries, while rejecting changed content.
export function canonicalJson(value: any): string {
  if (Array.isArray(value)) return '['+value.map(canonicalJson).join(',')+']';
  if (object(value)) return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalJson(value[key])).join(',')+'}';
  return JSON.stringify(value);
}

export function payloadHash(value: unknown): string {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function money(value: unknown): { amount: number; currency: string } {
  if (!object(value) || typeof value.value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value.value) || typeof value.currency_code !== 'string' || !/^[A-Z]{3}$/.test(value.currency_code)) {
    throw new InvalidEvent('Invalid provider amount.');
  }
  const [whole,fraction=''] = value.value.split('.');
  const amount = Number(whole)*100 + Number(fraction.padEnd(2,'0'));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new InvalidEvent('Invalid provider amount.');
  return {amount,currency:value.currency_code};
}
