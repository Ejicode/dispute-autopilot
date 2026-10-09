import { DisputeReason } from '../types';

export interface ReasonEvidenceRequirement {
  reason: DisputeReason;
  primaryEvidence: string[];
  secondaryEvidence: string[];
  description: string;
}

export const EVIDENCE_REQUIREMENTS: Record<DisputeReason, ReasonEvidenceRequirement> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: {
    reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
    primaryEvidence: ['TRACKING_HISTORY', 'PROOF_OF_DELIVERY'],
    secondaryEvidence: ['ORDER_CONFIRMATION', 'CUSTOMER_COMMUNICATION'],
    description: 'Buyer claims item was not delivered. PayPal requires online tracking showing delivery to buyer address.',
  },
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: {
    reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
    primaryEvidence: ['ORDER_CONFIRMATION', 'REFUND_POLICY'],
    secondaryEvidence: ['CUSTOMER_COMMUNICATION', 'TRACKING_HISTORY'],
    description: 'Buyer claims item is significantly not as described or damaged.',
  },
  UNAUTHORISED: {
    reason: 'UNAUTHORISED',
    primaryEvidence: ['PROOF_OF_DELIVERY', 'DEVICE_FINGERPRINT'],
    secondaryEvidence: ['ORDER_CONFIRMATION', 'CUSTOMER_COMMUNICATION'],
    description: 'Account holder claims they did not authorize the payment.',
  },
  INCORRECT_AMOUNT: {
    reason: 'INCORRECT_AMOUNT',
    primaryEvidence: ['ORDER_CONFIRMATION'],
    secondaryEvidence: ['CUSTOMER_COMMUNICATION'],
    description: 'Buyer claims charged amount was incorrect.',
  },
  DUPLICATE_TRANSACTION: {
    reason: 'DUPLICATE_TRANSACTION',
    primaryEvidence: ['ORDER_CONFIRMATION'],
    secondaryEvidence: ['CUSTOMER_COMMUNICATION'],
    description: 'Buyer claims duplicate charge for same purchase.',
  },
  BUYER_CANCELLED_SERVICE: {
    reason: 'BUYER_CANCELLED_SERVICE',
    primaryEvidence: ['REFUND_POLICY', 'CUSTOMER_COMMUNICATION'],
    secondaryEvidence: ['ORDER_CONFIRMATION'],
    description: 'Buyer claims recurring subscription was cancelled before charge.',
  },
  OTHER: {
    reason: 'OTHER',
    primaryEvidence: ['ORDER_CONFIRMATION', 'PROOF_OF_DELIVERY'],
    secondaryEvidence: ['CUSTOMER_COMMUNICATION'],
    description: 'Other dispute reason.',
  },
};
