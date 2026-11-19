/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { generateCouponCode, normaliseCouponCode } from './coupon-code.js';

describe('normaliseCouponCode', () => {
  it.each([
    ['spring-20', 'SPRING-20'],
    ['  Spring20  ', 'SPRING20'],
    ['ABCD', 'ABCD'],
    ['a'.repeat(24), 'A'.repeat(24)],
  ])('normalises %j to %j', (input, expected) => {
    expect(normaliseCouponCode(input)).toBe(expected);
  });

  it.each([
    ['abc', 'too short'],
    ['a'.repeat(25), 'too long'],
    ['spring 20', 'a space inside'],
    ['spring_20', 'punctuation'],
    ['spring!', 'punctuation'],
    ['', 'empty'],
    ['   ', 'blank'],
    ['café-20', 'a non-ASCII letter'],
  ])('refuses %j (%s)', (input) => {
    expect(normaliseCouponCode(input)).toBeUndefined();
  });
});

describe('generateCouponCode', () => {
  it('is XXXX-XXXX of Crockford base32, which normalising keeps', () => {
    for (let i = 0; i < 1000; i++) {
      const code = generateCouponCode();
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      expect(code).not.toMatch(/[ILOU]/);
      expect(normaliseCouponCode(code)).toBe(code);
    }
  });

  it('does not collide in 10,000 codes', () => {
    const codes = new Set(Array.from({ length: 10_000 }, generateCouponCode));
    expect(codes.size).toBe(10_000);
  });
});
