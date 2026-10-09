import { DisputeReason, EvidenceItem, TriageRecommendation } from '../types';

export interface TriageResult {
  score: number; // 0 to 100
  recommendation: TriageRecommendation;
  breakdown: Array<{ factor: string; points: number; earned: number; details: string }>;
}

/**
 * Deterministic Evidence Strength Score pure function
 * Evaluates how complete the merchant's held evidence is relative to PayPal expectations
 */
export function calculateEvidenceStrength(
  reason: DisputeReason,
  evidenceItems: EvidenceItem[]
): TriageResult {
  const breakdown: Array<{ factor: string; points: number; earned: number; details: string }> = [];

  const types = new Set(evidenceItems.map((e) => e.evidence_type));
  const fullContent = evidenceItems.map((e) => e.content).join(' ');

  let score = 0;

  if (reason === 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED') {
    // 1. Valid Tracking (+25)
    const hasTracking = types.has('TRACKING_HISTORY');
    const trackingEarned = hasTracking ? 25 : 0;
    breakdown.push({
      factor: 'Carrier Tracking Number Registered',
      points: 25,
      earned: trackingEarned,
      details: hasTracking ? 'Active carrier tracking record found' : 'Missing carrier tracking',
    });
    score += trackingEarned;

    // 2. Carrier In-Transit / Delivered (+25)
    const isDeliveredOrInTransit =
      fullContent.includes('DELIVERED') || fullContent.includes('IN_TRANSIT') || fullContent.includes('Delivered');
    const transitEarned = isDeliveredOrInTransit ? 25 : 0;
    breakdown.push({
      factor: 'Carrier Transit Milestone Verified',
      points: 25,
      earned: transitEarned,
      details: isDeliveredOrInTransit ? 'Carrier confirms package movement/delivery' : 'No carrier transit events',
    });
    score += transitEarned;

    // 3. Proof of Delivery (+25)
    const hasPOD = types.has('PROOF_OF_DELIVERY') || fullContent.includes('DELIVERED');
    const podEarned = hasPOD ? 25 : 0;
    breakdown.push({
      factor: 'Delivery Confirmation Timestamp',
      points: 25,
      earned: podEarned,
      details: hasPOD ? 'Physical or electronic delivery confirmation exists' : 'Missing delivery confirmation',
    });
    score += podEarned;

    // 4. Signature Confirmation (+15)
    const hasSignature = fullContent.includes('Signature') || fullContent.includes('SIGNATURE_VERIFIED');
    const sigEarned = hasSignature ? 15 : 0;
    breakdown.push({
      factor: 'Recipient Signature Confirmation',
      points: 15,
      earned: sigEarned,
      details: hasSignature ? 'Signature on file' : 'No signature required or recorded',
    });
    score += sigEarned;

    // 5. Order Confirmation / Invoice (+10)
    const hasOrder = types.has('ORDER_CONFIRMATION');
    const orderEarned = hasOrder ? 10 : 0;
    breakdown.push({
      factor: 'Order Confirmation & Invoice',
      points: 10,
      earned: orderEarned,
      details: hasOrder ? 'Matching merchant order record in vault' : 'Order record missing',
    });
    score += orderEarned;
  } else if (reason === 'UNAUTHORISED') {
    // 1. Device Fingerprint / IP Log (+35)
    const hasDevice = types.has('DEVICE_FINGERPRINT') || fullContent.includes('ip_address');
    const deviceEarned = hasDevice ? 35 : 0;
    breakdown.push({
      factor: 'Checkout Device & IP Fingerprint',
      points: 35,
      earned: deviceEarned,
      details: hasDevice ? 'Device fingerprint & IP logged at payment' : 'No device log captured',
    });
    score += deviceEarned;

    // 2. Shipping Address Match (+35)
    const hasPOD = types.has('PROOF_OF_DELIVERY') || types.has('TRACKING_HISTORY');
    const addressEarned = hasPOD ? 35 : 0;
    breakdown.push({
      factor: 'Shipment to Confirmed Address',
      points: 35,
      earned: addressEarned,
      details: hasPOD ? 'Delivered to buyer PayPal registered address' : 'Address verification missing',
    });
    score += addressEarned;

    // 3. Order Record (+20)
    const hasOrder = types.has('ORDER_CONFIRMATION');
    const orderEarned = hasOrder ? 20 : 0;
    breakdown.push({
      factor: 'Itemized Order Record',
      points: 20,
      earned: orderEarned,
      details: hasOrder ? 'Order snapshot present' : 'Order snapshot missing',
    });
    score += orderEarned;

    // 4. Communication History (+10)
    const hasComms = types.has('CUSTOMER_COMMUNICATION');
    const commsEarned = hasComms ? 10 : 0;
    breakdown.push({
      factor: 'Customer Correspondence',
      points: 10,
      earned: commsEarned,
      details: hasComms ? 'Pre-dispute customer email on file' : 'No customer messages',
    });
    score += commsEarned;
  } else {
    // SNAD / Other
    // 1. Policy Documented (+30)
    const hasPolicy = types.has('REFUND_POLICY') || fullContent.includes('terms') || fullContent.includes('policy');
    const polEarned = hasPolicy ? 30 : 0;
    breakdown.push({
      factor: 'Documented Store Policy & Terms',
      points: 30,
      earned: polEarned,
      details: hasPolicy ? 'Terms and conditions accepted at checkout' : 'No terms record',
    });
    score += polEarned;

    // 2. Item Description & Specifications (+30)
    const hasOrder = types.has('ORDER_CONFIRMATION');
    const orderEarned = hasOrder ? 30 : 0;
    breakdown.push({
      factor: 'Detailed Item Description & Specs',
      points: 30,
      earned: orderEarned,
      details: hasOrder ? 'Original product specs and listing preserved' : 'Product description missing',
    });
    score += orderEarned;

    // 3. Tracking / Delivery (+20)
    const hasDelivery = types.has('PROOF_OF_DELIVERY') || types.has('TRACKING_HISTORY');
    const delEarned = hasDelivery ? 20 : 0;
    breakdown.push({
      factor: 'Proof of Delivery',
      points: 20,
      earned: delEarned,
      details: hasDelivery ? 'Delivery verified' : 'Delivery missing',
    });
    score += delEarned;

    // 4. Comms (+20)
    const hasComms = types.has('CUSTOMER_COMMUNICATION');
    const commEarned = hasComms ? 20 : 0;
    breakdown.push({
      factor: 'Support Ticket History',
      points: 20,
      earned: commEarned,
      details: hasComms ? 'Customer support interactions logged' : 'No ticket found',
    });
    score += commEarned;
  }

  // Bound score 0-100
  const finalScore = Math.max(0, Math.min(100, score));

  // Triage Policy Rules
  let recommendation: TriageRecommendation = 'ASK A HUMAN';
  if (finalScore >= 70) {
    recommendation = 'FIGHT';
  } else if (finalScore < 35) {
    recommendation = 'ACCEPT';
  } else {
    recommendation = 'ASK A HUMAN';
  }

  return {
    score: finalScore,
    recommendation,
    breakdown,
  };
}
