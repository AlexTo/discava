/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatPrice } from '@discava/common-web-utils/price';

export type CouponStatus = 'disabled' | 'expired' | 'used up' | 'active';

export interface CouponItem {
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  currency?: string | undefined;
  expiresAt?: string | undefined;
  maxRedemptions?: number | undefined;
  redeemedCount: number;
  enabled: boolean;
  status: CouponStatus;
}

/** "20% off" or "$5.00 off". */
export const describeValue = (coupon: CouponItem) =>
  coupon.type === 'percent'
    ? `${coupon.value}% off`
    : `${formatPrice(coupon.value, coupon.currency ?? 'USD')} off`;

/** "Ends 30 Nov, UTC" or "No expiry". */
export const describeExpiry = (coupon: CouponItem) =>
  coupon.expiresAt === undefined
    ? 'No expiry'
    : `Ends ${new Date(coupon.expiresAt).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      })}, UTC`;

/** "3 of 10 used" or "3 used". */
export const describeUse = (coupon: CouponItem) =>
  coupon.maxRedemptions === undefined
    ? `${coupon.redeemedCount} used`
    : `${coupon.redeemedCount} of ${coupon.maxRedemptions} used`;

/** The stored expiry (the end of a UTC day) as the date a field shows. */
export const expiresOnOf = (coupon: CouponItem) =>
  coupon.expiresAt?.slice(0, 10) ?? '';

export const todayUtc = () => new Date().toISOString().slice(0, 10);
