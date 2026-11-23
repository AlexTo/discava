/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { couponValueProblem } from './coupon-input.js';

const check = (type: 'percent' | 'fixed', value: number, currency = 'USD') =>
  couponValueProblem({ type, value, currency, listAmount: 5000 });

describe('couponValueProblem', () => {
  it.each([
    ['percent', 1],
    ['percent', 100],
    ['fixed', 1],
    ['fixed', 5000],
  ] as const)('accepts %s %i', (type, value) => {
    expect(check(type, value)).toBeUndefined();
  });

  it.each([
    ['percent', 0],
    ['percent', 101],
    ['percent', 12.5],
    ['fixed', 0],
    ['fixed', 5001],
    ['fixed', -1],
  ] as const)('refuses %s %i, naming the value', (type, value) => {
    expect(check(type, value)).toMatch(/value/);
  });

  it('refuses a fixed coupon without a currency', () => {
    expect(check('fixed', 100, '')).toMatch(/currency/);
  });

  it('needs no currency for a percentage', () => {
    expect(check('percent', 10, '')).toBeUndefined();
  });
});
