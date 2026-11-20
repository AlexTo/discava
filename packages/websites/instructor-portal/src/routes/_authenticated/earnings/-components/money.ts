/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatPrice } from '@discava/common-web-utils/price';

/**
 * An amount in the smallest unit of its currency ("$19.99"). Unlike a price,
 * zero is an amount ("$0.00") and a negative one keeps its sign.
 */
export const formatMoney = (amount: number, currency: string): string =>
  amount === 0
    ? formatPrice(1, currency).replace(/[\d.,]+/, '0.00')
    : formatPrice(amount, currency);

export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-AU', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });
