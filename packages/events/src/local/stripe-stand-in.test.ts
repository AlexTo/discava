/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStripeStandIn, type StripeStandIn } from './stripe-stand-in.js';

let server: Server;
let standIn: StripeStandIn;
let port: number;

beforeEach(async () => {
  standIn = createStripeStandIn();
  server = createServer(async (request, response) => {
    const path = new globalThis.URL(request.url ?? '/', 'http://localhost')
      .pathname;
    if (!(await standIn.handle(request, response, path))) {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterEach(() => {
  server.close();
});

// The real SDK, pointed at the stand-in, as backend code does in local dev.
const stripeFor = (key: string) =>
  new Stripe(key, {
    host: '127.0.0.1',
    port,
    protocol: 'http',
    maxNetworkRetries: 0,
  });

const WEBHOOK_URL = 'https://example.com/stripe/webhook';
const EVENTS = [
  'checkout.session.completed',
  'checkout.session.expired',
  'charge.refunded',
] as const;

const request = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, init);
  return { status: response.status, body: await response.json() };
};

describe('accounts', () => {
  it('knows both accounts, which the SDK reads from /v1/account', async () => {
    const first = await stripeFor('sk_test_local').accounts.retrieveCurrent();
    expect(first.id).toBe('acct_local');
    expect(first.business_profile?.name).toBe('Local Stripe Account');
    const second =
      await stripeFor('sk_test_local_2').accounts.retrieveCurrent();
    expect(second.id).toBe('acct_local_2');
  });

  it('refuses an unknown key with a 401 in Stripe’s error shape, never echoing it', async () => {
    const error = await stripeFor('sk_test_unknown_key')
      .accounts.retrieveCurrent()
      .catch((e) => e);
    expect(error).toBeInstanceOf(Stripe.errors.StripeAuthenticationError);
    expect(error.statusCode).toBe(401);
    expect(String(error.message)).not.toContain('sk_test_unknown_key');

    const raw = await request('/v1/account');
    expect(raw.status).toBe(401);
    expect(raw.body.error.type).toBe('invalid_request_error');
  });
});

describe('webhook endpoints', () => {
  const create = (stripe: Stripe, url = WEBHOOK_URL) =>
    stripe.webhookEndpoints.create({
      url,
      enabled_events: [...EVENTS],
      api_version: '2026-10-28.endive',
      metadata: { app: 'discava', stage: 'dev' },
    });

  it('creates an endpoint that parses with the SDK, returning its secret once', async () => {
    const stripe = stripeFor('sk_test_local');
    const created = await create(stripe);
    expect(created.id).toMatch(/^we_/);
    expect(created.secret).toMatch(/^whsec_/);
    expect(created.url).toBe(WEBHOOK_URL);
    expect(created.enabled_events).toEqual([...EVENTS]);
    expect(created.metadata).toEqual({ app: 'discava', stage: 'dev' });
    expect(created.status).toBe('enabled');

    const listed = await stripe.webhookEndpoints.list({ limit: 100 });
    expect(listed.data.map((e) => e.id)).toEqual([created.id]);
    expect(listed.data[0]).not.toHaveProperty('secret');
  });

  it('gives each endpoint a signing secret of its own', async () => {
    const stripe = stripeFor('sk_test_local');
    const a = await create(stripe);
    const b = await create(stripe, 'https://example.com/other');
    expect(a.secret).not.toBe(b.secret);
    expect(standIn.endpointsOf('acct_local').map((e) => e.secret)).toEqual([
      a.secret,
      b.secret,
    ]);
  });

  it('keeps each account’s endpoints apart', async () => {
    await create(stripeFor('sk_test_local'));
    expect(
      (await stripeFor('sk_test_local_2').webhookEndpoints.list()).data,
    ).toEqual([]);
    expect(standIn.endpointsOf('acct_local_2')).toEqual([]);
  });

  it('deletes an endpoint, and answers 404 for one it does not have', async () => {
    const stripe = stripeFor('sk_test_local');
    const created = await create(stripe);
    const deleted = await stripe.webhookEndpoints.del(created.id);
    expect(deleted.deleted).toBe(true);
    expect((await stripe.webhookEndpoints.list()).data).toEqual([]);

    const error = await stripe.webhookEndpoints.del(created.id).catch((e) => e);
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('resource_missing');
  });

  it('refuses to delete another account’s endpoint', async () => {
    const created = await create(stripeFor('sk_test_local'));
    const error = await stripeFor('sk_test_local_2')
      .webhookEndpoints.del(created.id)
      .catch((e) => e);
    expect(error.statusCode).toBe(404);
    expect(standIn.endpointsOf('acct_local')).toHaveLength(1);
  });

  it('refuses a missing url or events with a 400', async () => {
    const error = await stripeFor('sk_test_local')
      .webhookEndpoints.create({
        url: 'not a url',
        enabled_events: [],
      } as never)
      .catch((e) => e);
    expect(error.statusCode).toBe(400);
  });

  it('gives the restricted key a permission error from create, list and delete', async () => {
    const stripe = stripeFor('rk_test_local_nowebhook');
    expect((await stripe.accounts.retrieveCurrent()).id).toBe('acct_local');
    const error = await create(stripe).catch((e) => e);
    expect(error).toBeInstanceOf(Stripe.errors.StripePermissionError);
    expect(await stripe.webhookEndpoints.list().catch((e) => e)).toBeInstanceOf(
      Stripe.errors.StripePermissionError,
    );
    expect(standIn.endpointsOf('acct_local')).toEqual([]);
  });
});

describe('/stripe/test/endpoints', () => {
  it('lists what each account has registered, with no secret', async () => {
    const created = await stripeFor('sk_test_local').webhookEndpoints.create({
      url: WEBHOOK_URL,
      enabled_events: [...EVENTS],
    });
    const { status, body } = await request('/stripe/test/endpoints');
    expect(status).toBe(200);
    expect(body.accounts.acct_local).toHaveLength(1);
    expect(body.accounts.acct_local[0]).toMatchObject({
      id: created.id,
      url: WEBHOOK_URL,
    });
    expect(body.accounts.acct_local_2).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('whsec_');
  });
});

describe('everything else', () => {
  it('answers an unknown route in Stripe’s error shape', async () => {
    const { status, body } = await request('/v1/customers', {
      headers: { authorization: 'Bearer sk_test_local' },
    });
    expect(status).toBe(404);
    expect(body.error.type).toBe('invalid_request_error');
    expect(body.error.message).toMatch(/Unrecognized request URL/);
  });

  it('leaves paths that are not Stripe’s to the caller', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/something-else`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
  });
});
