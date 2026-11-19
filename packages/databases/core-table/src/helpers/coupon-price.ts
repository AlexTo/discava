/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// Prices are integers in a currency's minor units (cents, or whole yen for a
// zero-decimal currency). Nothing here knows of orders or Stripe.

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
 * Stripe's documented minimum charge per currency, in minor units. A total
 * above zero and under this can't be paid for. Currencies not listed use the
 * USD figure.
 */
export const MIN_CHARGE_MINOR: Record<string, number> = {
  usd: 50,
  eur: 50,
  gbp: 30,
  aud: 50,
  cad: 50,
  nzd: 50,
  chf: 50,
  sgd: 50,
  jpy: 50,
};

const DEFAULT_MIN_CHARGE_MINOR = 50;

export const minimumCharge = (currency: string): number =>
  MIN_CHARGE_MINOR[currency.toLowerCase()] ?? DEFAULT_MIN_CHARGE_MINOR;

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
  currency: string;
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
