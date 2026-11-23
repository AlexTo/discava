/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Why a new coupon's value is refused, or `undefined` when it is fine: the
 * rule the `coupon-within-limit` invariant checks of every stored coupon.
 * Every writer that creates a coupon calls it.
 */
export const couponValueProblem = (coupon: {
  type: 'percent' | 'fixed';
  value: number;
  currency?: string | undefined;
  listAmount: number;
}): string | undefined => {
  if (!Number.isInteger(coupon.value)) {
    return 'value must be a whole number';
  }
  if (coupon.type === 'percent') {
    return coupon.value >= 1 && coupon.value <= 100
      ? undefined
      : 'value must be between 1 and 100 for a percentage';
  }
  if (!coupon.currency) {
    return 'a fixed coupon needs a currency';
  }
  if (coupon.value < 1) {
    return 'value must be above 0 for a fixed amount';
  }
  return coupon.value <= coupon.listAmount
    ? undefined
    : "value must not be above the course's price";
};
