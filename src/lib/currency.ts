// Supported PayPal currencies and zero-decimal minor currency unit handling

export const ZERO_DECIMAL_CURRENCIES = new Set([
  'JPY', 'KRW', 'HUF', 'TWD', 'BIF', 'CLP', 'DJF', 'GNF',
  'ISK', 'KMF', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'
]);

export interface CurrencyOption {
  code: string;
  symbol: string;
  name: string;
}

export const SUPPORTED_CURRENCIES: CurrencyOption[] = [
  { code: 'USD', symbol: '$', name: 'USD — US Dollar ($)' },
  { code: 'EUR', symbol: '€', name: 'EUR — Euro (€)' },
  { code: 'GBP', symbol: '£', name: 'GBP — British Pound (£)' },
  { code: 'CAD', symbol: 'CA$', name: 'CAD — Canadian Dollar (CA$)' },
  { code: 'AUD', symbol: 'A$', name: 'AUD — Australian Dollar (A$)' },
  { code: 'JPY', symbol: '¥', name: 'JPY — Japanese Yen (¥)' },
  { code: 'CHF', symbol: 'CHF', name: 'CHF — Swiss Franc (CHF)' },
  { code: 'SGD', symbol: 'S$', name: 'SGD — Singapore Dollar (S$)' },
  { code: 'NZD', symbol: 'NZ$', name: 'NZD — New Zealand Dollar (NZ$)' },
  { code: 'HKD', symbol: 'HK$', name: 'HKD — Hong Kong Dollar (HK$)' },
];

/**
 * Formats minor units (cents) into a localized currency string according to ISO 4217 & PayPal standards.
 */
export function formatCurrency(cents: number, currency: string = 'USD'): string {
  const code = (currency || 'USD').toUpperCase().trim();
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(code);
  const amount = isZeroDecimal ? cents : cents / 100;

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: isZeroDecimal ? 0 : 2,
      maximumFractionDigits: isZeroDecimal ? 0 : 2,
    }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(isZeroDecimal ? 0 : 2)}`;
  }
}

/**
 * Returns the currency symbol or prefix for a given currency code.
 */
export function getCurrencySymbol(currency: string = 'USD'): string {
  const code = (currency || 'USD').toUpperCase().trim();
  const match = SUPPORTED_CURRENCIES.find((c) => c.code === code);
  if (match) return match.symbol;
  try {
    const parts = new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).formatToParts(0);
    const sym = parts.find((p) => p.type === 'currency');
    return sym?.value || code;
  } catch {
    return code;
  }
}
