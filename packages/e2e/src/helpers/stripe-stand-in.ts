/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { apiUser } from './api.js';

// The local Stripe stand-in's controls, served by the event runner (see
// specs/…/contracts/stripe-stand-in.md). Only the stand-in has them; the real
// Stripe has no such endpoints.

const RUNNER = 'http://localhost:2024';
const API_KEY = 'sk_test_local';

// The session a hosted payment page's address belongs to.
export const sessionIdOf = (checkoutUrl: string) => {
  const id = /\/stripe\/pay\/([^/?#]+)/.exec(checkoutUrl)?.[1];
  if (!id) throw new Error(`Not a stand-in payment page: ${checkoutUrl}`);
  return decodeURIComponent(id);
};

const control = async <T>(name: string, body: object): Promise<T> => {
  const response = await fetch(`${RUNNER}/stripe/test/${name}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`The stand-in's ${name} control: ${response.status}`);
  }
  return (await response.json()) as T;
};

// Connects payments the way an administrator does, with the stand-in's key.
// A no-op when already active, so every payment scenario can call it first: a
// fresh local stack starts disconnected.
export const connectStripeStandIn = async () => {
  const { admin } = await apiUser('Carol', ['admin']);
  const status = await admin.payment.status.query();
  if (status.state === 'active') return;
  await admin.payment.connect.mutate({ secretKey: API_KEY });
};

// Pays, declines or cancels a checkout as the hosted page's buttons do,
// without a browser. Returns the status the stand-in answered with: 303 to
// the success or cancel address, 200 for a decline's page.
export const actOnHostedPage = async (
  sessionId: string,
  action: 'pay' | 'decline' | 'cancel',
) =>
  (
    await fetch(
      `${RUNNER}/stripe/pay/${encodeURIComponent(sessionId)}/${action}`,
      {
        method: 'POST',
        redirect: 'manual',
      },
    )
  ).status;

// Delivers the session's last event again, `times` at the same moment.
export const replayEvent = (sessionId: string, times = 1) =>
  control<{ delivered: number[] }>('replay', { sessionId, times });

// Delivers it with a bad signature or a changed body; the webhook must refuse.
export const forgeEvent = (sessionId: string, kind: 'signature' | 'body') =>
  control<{ delivered: number[] }>('forge', { sessionId, kind });

export const expireSession = (sessionId: string) =>
  control<{ status: string }>('expire', { sessionId });

// An operator's refund in the dashboard: all of the payment, or `amount`.
export const refundSession = (sessionId: string, amount?: number) =>
  control<{ amount_refunded: number }>('refund', { sessionId, amount });

// Every refund the stand-in made for the session's payment.
export const sessionRefunds = async (sessionId: string) =>
  (await control<{ refunds: { amount: number }[] }>('refunds', { sessionId }))
    .refunds;
