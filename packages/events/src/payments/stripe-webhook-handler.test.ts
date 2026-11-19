/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { stripeWebhook } from './stripe-webhook-handler.js';

const handle = vi.fn(async () => ({ status: 200 as const }));

describe('stripeWebhook', () => {
  it('passes the exact bytes and the signature header, in any case', async () => {
    const body = '{"a": 1,  "b":2}';
    const result = await stripeWebhook(
      { body, headers: { 'STRIPE-SIGNATURE': 't=1,v1=abc' } },
      handle,
    );
    expect(handle).toHaveBeenLastCalledWith(Buffer.from(body), 't=1,v1=abc');
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ received: true });
  });

  it('decodes a base64 body to the bytes that were sent', async () => {
    const body = '{"emoji":"é"}';
    await stripeWebhook(
      {
        body: Buffer.from(body).toString('base64'),
        isBase64Encoded: true,
        headers: { 'Stripe-Signature': 'sig' },
      },
      handle,
    );
    expect(handle).toHaveBeenLastCalledWith(Buffer.from(body), 'sig');
  });

  it('passes no signature when the header is missing', async () => {
    await stripeWebhook({ body: '{}', headers: {} }, handle);
    expect(handle).toHaveBeenLastCalledWith(Buffer.from('{}'), undefined);
  });

  it('answers with the status and an empty body for a refusal', async () => {
    handle.mockResolvedValueOnce({ status: 400 as any });
    const result = await stripeWebhook({ body: '{}', headers: {} }, handle);
    expect(result).toMatchObject({ statusCode: 400, body: '' });
  });
});
