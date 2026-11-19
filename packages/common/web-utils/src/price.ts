/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// The currencies a course can be priced in. All are two-decimal currencies, so
// an amount in the smallest unit is cents/pence and the page can show it by
// dividing by 100. A zero-decimal or three-decimal currency needs its own
// scale and isn't supported.
export const SUPPORTED_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'AUD',
  'CAD',
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

// The bounds of a non-zero price, in the smallest unit (1.00 to 10,000.00).
export const PRICE_MIN = 100;
export const PRICE_MAX = 1_000_000;

export const isSupportedCurrency = (
  currency: string,
): currency is SupportedCurrency =>
  (SUPPORTED_CURRENCIES as readonly string[]).includes(currency);

/**
 * The message for the rule a price breaks, or `undefined` when it's valid. An
 * amount of `0` is free; any other must be a whole number within the bounds.
 */
export const validatePrice = ({
  amount,
  currency,
}: {
  amount: number;
  currency: string;
}): string | undefined => {
  if (!isSupportedCurrency(currency)) {
    return `The currency must be one of ${SUPPORTED_CURRENCIES.join(', ')}`;
  }
  if (!Number.isInteger(amount)) {
    return 'The price must be a whole number of the smallest currency unit';
  }
  if (amount !== 0 && (amount < PRICE_MIN || amount > PRICE_MAX)) {
    return 'The price must be free, or between 1.00 and 10,000.00';
  }
  return undefined;
};

/**
 * Reads what a person typed ("19.99") as an amount in the smallest unit
 * (1999), or `undefined` when it isn't a price with at most two decimals, or is
 * above zero and under the minimum. It
 * splits on the decimal point instead of multiplying, so no floating point
 * rounding can change the amount.
 */
export const parsePriceInput = (input: string): number | undefined => {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) return undefined;
  const whole = match[1] as string;
  const fraction = (match[2] ?? '').padEnd(2, '0');
  const amount = Number.parseInt(`${whole}${fraction}`, 10);
  if (!Number.isSafeInteger(amount)) return undefined;
  // Something like "0.5" is a typo for a price, not a price: only free or at
  // least the minimum reads as one.
  return amount !== 0 && amount < PRICE_MIN ? undefined : amount;
};

/** "Free" for `0`, otherwise the amount in its currency ("$19.99"). */
export const formatPrice = (amount: number, currency: string): string =>
  amount === 0
    ? 'Free'
    : new Intl.NumberFormat('en', { style: 'currency', currency }).format(
        amount / 100,
      );
