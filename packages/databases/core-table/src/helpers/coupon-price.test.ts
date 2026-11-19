/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  belowMinimumCharge,
  MIN_CHARGE_MINOR,
  priceWithCoupon,
} from './coupon-price.js';

const percent = (value: number) => ({ type: 'percent' as const, value });
const fixed = (value: number) => ({ type: 'fixed' as const, value });
const price = (
  listAmount: number,
  coupon: ReturnType<typeof percent>,
  currency = 'usd',
) => priceWithCoupon({ listAmount, currency, coupon });

describe('priceWithCoupon', () => {
  it.each([
    [10000, 1, 100, 9900],
    [10000, 33, 3300, 6700],
    [10000, 50, 5000, 5000],
    [10000, 100, 10000, 0],
    // Odd amounts round the discount down.
    [999, 33, 329, 670],
    [999, 50, 499, 500],
    [1, 50, 0, 1],
    [1999, 1, 19, 1980],
  ])('%i with %i%% off takes %i, leaving %i', (list, pct, discount, total) => {
    expect(price(list, percent(pct))).toEqual({
      listAmount: list,
      discountAmount: discount,
      totalAmount: total,
      isFree: total === 0,
    });
  });

  it.each([
    [5000, 1000, 1000, 4000],
    [5000, 5000, 5000, 0],
    [5000, 7000, 5000, 0],
  ])(
    '%i with %i off takes %i, never below zero',
    (list, value, discount, total) => {
      const result = price(list, fixed(value));
      expect(result.discountAmount).toBe(discount);
      expect(result.totalAmount).toBe(total);
      expect(result.isFree).toBe(total === 0);
    },
  );

  it('works in whole units for a zero-decimal currency', () => {
    expect(price(3000, percent(33), 'jpy')).toEqual({
      listAmount: 3000,
      discountAmount: 990,
      totalAmount: 2010,
      isFree: false,
    });
  });

  it('is free only at a zero total', () => {
    expect(price(10000, percent(99)).isFree).toBe(false);
    expect(price(10000, percent(100)).isFree).toBe(true);
  });
});

describe('belowMinimumCharge', () => {
  it.each(Object.entries(MIN_CHARGE_MINOR))(
    'is false at zero and at the minimum, true just under it, in %s',
    (currency, minimum) => {
      expect(belowMinimumCharge(0, currency)).toBe(false);
      expect(belowMinimumCharge(1, currency)).toBe(minimum > 1);
      expect(belowMinimumCharge(minimum - 1, currency)).toBe(true);
      expect(belowMinimumCharge(minimum, currency)).toBe(false);
      expect(belowMinimumCharge(minimum + 1, currency)).toBe(false);
    },
  );

  it('ignores the case of the currency', () => {
    expect(belowMinimumCharge(10, 'USD')).toBe(true);
  });
});
