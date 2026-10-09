/**
 * Prompt Injection Defense & Sanitization
 * Enforces rule: Untrusted text stays data
 */

export interface SanitizedInput {
  isSafe: boolean;
  sanitizedText: string;
  detectedFlags: string[];
}

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /system\s+override/i,
  /you\s+are\s+now\s+(in\s+)?(developer|maintenance|god)\s+mode/i,
  /refund\s+(all|immediately|everything|\$\d+)/i,
  /call\s+tool\s+\w+/i,
  /disregard\s+the\s+evidence/i,
  /grant\s+the\s+claim/i,
  /<script>/i,
  /DROP\s+TABLE/i,
];

export function sanitizeUntrustedBuyerText(rawInput: string): SanitizedInput {
  const flags: string[] = [];

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(rawInput)) {
      flags.push(`Matched suspicious pattern: ${pattern.source}`);
    }
  }

  // Neutralize markup / XML tags that could trick parser
  const sanitized = rawInput
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[`${}]/g, '');

  return {
    isSafe: flags.length === 0,
    sanitizedText: sanitized,
    detectedFlags: flags,
  };
}

/**
 * Format untrusted data in an isolated fence block for AI context
 */
export function wrapUntrustedData(label: string, text: string): string {
  const { sanitizedText } = sanitizeUntrustedBuyerText(text);
  return `\n<<<DATA_BLOCK_UNTRUSTED label="${label}">>>\n${sanitizedText}\n<<</DATA_BLOCK_UNTRUSTED>>>\n`;
}
