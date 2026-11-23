/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// Prices are integers in a currency's minor units (cents or pence: every
// supported currency has two decimals, so no rounding depends on the
// currency). Nothing here knows of orders or Stripe.

export interface PricedCoupon {
  type: 'percent' | 'fixed';
  value: number;
}

export interface CouponPrice {
  listAmount: number;
  discountAmount: number;
  totalAmount: number;
  /** The total is zero, so no payment is taken. */
  isFree: boolean;
}

/**
 * Stripe's documented minimum charge, in minor units, for each currency a
 * course can be priced in (`SUPPORTED_CURRENCIES` in common-web-utils, all
 * two-decimal). A total above zero and under this can't be paid for. Keys are
 * lower case; a currency a course can't be priced in has no entry.
 */
export const MIN_CHARGE_MINOR: Record<string, number> = {
  usd: 50,
  eur: 50,
  gbp: 30,
  aud: 50,
  cad: 50,
};

/** The minimum charge for a currency; throws for one a course can't be priced in. */
export const minimumCharge = (currency: string): number => {
  const minimum = MIN_CHARGE_MINOR[currency.toLowerCase()];
  if (minimum === undefined) {
    throw new RangeError(`No minimum charge is known for ${currency}`);
  }
  return minimum;
};

/**
 * What a student pays for a course with a coupon. A percent discount is
 * rounded down; a fixed one never takes more than the list price, so the total
 * is never negative.
 */
export const priceWithCoupon = ({
  listAmount,
  coupon,
}: {
  listAmount: number;
  coupon: PricedCoupon;
}): CouponPrice => {
  const discount =
    coupon.type === 'percent'
      ? Math.floor((listAmount * coupon.value) / 100)
      : Math.min(coupon.value, listAmount);
  const discountAmount = Math.max(0, Math.min(discount, listAmount));
  const totalAmount = listAmount - discountAmount;
  return {
    listAmount,
    discountAmount,
    totalAmount,
    isFree: totalAmount === 0,
  };
};

/** True when the total is above zero but under the currency's minimum. */
export const belowMinimumCharge = (
  totalAmount: number,
  currency: string,
): boolean => totalAmount > 0 && totalAmount < minimumCharge(currency);
