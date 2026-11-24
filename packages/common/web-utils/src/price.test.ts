/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatPrice,
  PRICE_MAX,
  PRICE_MIN,
  parsePriceInput,
  refundTerms,
  SUPPORTED_CURRENCIES,
  validatePrice,
} from './price';

describe('validatePrice', () => {
  it('lists the supported currencies and bounds', () => {
    expect(SUPPORTED_CURRENCIES).toEqual(['USD', 'EUR', 'GBP', 'AUD', 'CAD']);
    expect(PRICE_MIN).toBe(100);
    expect(PRICE_MAX).toBe(1_000_000);
  });

  it.each([0, 100, 101, 1999, 1_000_000])('accepts %i', (amount) => {
    expect(validatePrice({ amount, currency: 'USD' })).toBeUndefined();
  });

  it.each([1, 99, 1_000_001, -100])('refuses %i', (amount) => {
    expect(validatePrice({ amount, currency: 'USD' })).toEqual(
      expect.any(String),
    );
  });

  it('refuses a non-integer', () => {
    expect(validatePrice({ amount: 100.5, currency: 'USD' })).toEqual(
      expect.any(String),
    );
    expect(validatePrice({ amount: Number.NaN, currency: 'USD' })).toEqual(
      expect.any(String),
    );
  });

  it.each(SUPPORTED_CURRENCIES)('accepts %s', (currency) => {
    expect(validatePrice({ amount: 500, currency })).toBeUndefined();
  });

  it('refuses an unsupported currency, even for a free price', () => {
    expect(validatePrice({ amount: 500, currency: 'JPY' })).toEqual(
      expect.any(String),
    );
    expect(validatePrice({ amount: 0, currency: 'usd' })).toEqual(
      expect.any(String),
    );
  });
});

describe('parsePriceInput', () => {
  it.each([
    ['19.99', 1999],
    ['19.9', 1990],
    ['19', 1900],
    ['0', 0],
    ['0.00', 0],
    ['1000000.00', 100_000_000],
    [' 5.10 ', 510],
    ['1.1', 110],
    ['4.35', 435],
    ['8.2', 820],
  ])('parses %s to %i', (input, expected) => {
    expect(parsePriceInput(input)).toBe(expected);
  });

  it.each(['abc', '', '.', '-1', '-0.50', '1.234', '1e3', '1,5', '0x10', '1.'])(
    'rejects %j',
    (input) => {
      expect(parsePriceInput(input)).toBeUndefined();
    },
  );

  it.each(['0.5', '0.99', '0.01'])(
    'rejects %s, a non-zero amount under the minimum',
    (input) => {
      expect(parsePriceInput(input)).toBeUndefined();
    },
  );

  it('round-trips through formatPrice', () => {
    for (const amount of [100, 1999, 123_456, 1_000_000]) {
      const text = (amount / 100).toFixed(2);
      expect(parsePriceInput(text)).toBe(amount);
    }
  });

  it('uses no floating point arithmetic', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/price.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(source).not.toMatch(/parseFloat/);
    expect(source).not.toMatch(/Number\([^)]*\)\s*\*\s*100/);
  });
});

describe('formatPrice', () => {
  it('says Free for zero', () => {
    expect(formatPrice(0, 'USD')).toBe('Free');
  });

  it('formats each currency with its symbol', () => {
    expect(formatPrice(1999, 'USD')).toBe('$19.99');
    expect(formatPrice(1999, 'EUR')).toContain('19.99');
    expect(formatPrice(1999, 'EUR')).toContain('€');
    expect(formatPrice(1999, 'GBP')).toContain('£');
    expect(formatPrice(1999, 'AUD')).toContain('19.99');
    expect(formatPrice(1999, 'CAD')).toContain('19.99');
  });
});

describe('refundTerms', () => {
  it('takes the number of days and the progress limit', () => {
    expect(refundTerms(14, 50)).toBe(
      "14-day refund while you've completed less than half of the course. One refund per course.",
    );
    expect(refundTerms(30, 50)).toBe(
      "30-day refund while you've completed less than half of the course. One refund per course.",
    );
  });

  it('states a limit other than half as a percentage', () => {
    expect(refundTerms(14, 30)).toBe(
      "14-day refund while you've completed less than 30% of the course. One refund per course.",
    );
  });
});
