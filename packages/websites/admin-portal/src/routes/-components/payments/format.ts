/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IPaymentStatus } from '@discava/admin-api';

export type PaymentChange = IPaymentStatus['changes'][number];

export const formatWhen = (iso: string) => new Date(iso).toLocaleString();

export const keyEnding = (last4: string) => `Key ending ····${last4}`;

export const CHANGE_KIND: Record<PaymentChange['kind'], string> = {
  connected: 'Connected',
  replaced: 'Key replaced',
  switched: 'Switched account',
  disconnected: 'Disconnected',
  failed: 'Failed',
};

// The step a failed save stopped at, in words.
export const FAILED_STEP: Record<NonNullable<PaymentChange['step']>, string> = {
  key: 'the key was refused',
  account: "Stripe's account couldn't be read",
  registration: "the confirmation address couldn't be registered",
  storage: "the key couldn't be stored",
  busy: 'another change was in progress',
  'open-checkout': 'checkouts were still open',
};
