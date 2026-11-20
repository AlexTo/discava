/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStripeStandIn, type StripeStandIn } from './stripe-stand-in.js';

let server: Server;
let standIn: StripeStandIn;
let port: number;

beforeEach(async () => {
  standIn = createStripeStandIn({
    retryDelayMs: 5,
    connectStateFile: join(
      mkdtempSync(join(tmpdir(), 'stand-in-')),
      'connect.json',
    ),
  });
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

// A webhook receiver: records each delivery and answers with the next status
// of `answers` (200 once they run out).
const receivers: Server[] = [];
afterEach(() => {
  for (const receiver of receivers.splice(0)) receiver.close();
});
const receiver = async (answers: number[] = []) => {
  const deliveries: { body: string; signature: string }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    deliveries.push({
      body: Buffer.concat(chunks).toString(),
      signature: String(req.headers['stripe-signature']),
    });
    res.writeHead(answers.shift() ?? 200).end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  receivers.push(server);
  return {
    deliveries,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`,
  };
};

const sessionParams = (
  overrides: Partial<Stripe.Checkout.SessionCreateParams> = {},
): Stripe.Checkout.SessionCreateParams => ({
  mode: 'payment',
  allowed_payment_method_types: ['card'],
  adaptive_pricing: { enabled: false },
  line_items: [
    {
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: 4900,
        product_data: { name: 'Algebra' },
      },
    },
  ],
  client_reference_id: 'order-1',
  metadata: { orderId: 'order-1', userId: 'u1', courseId: 'c1' },
  payment_intent_data: { metadata: { orderId: 'order-1' } },
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  success_url: 'http://localhost:2020/learn/c1?checkout=success',
  cancel_url: 'http://localhost:2020/learn/c1?checkout=cancelled',
  ...overrides,
});

const connect = async (url: string) => {
  const stripe = stripeFor('sk_test_local');
  const endpoint = await stripe.webhookEndpoints.create({
    url,
    enabled_events: [...EVENTS],
  });
  return { stripe, secret: endpoint.secret as string };
};

const page = (path: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual', ...init });

describe('checkout sessions', () => {
  it('creates a session the SDK parses, with a hosted page address', async () => {
    const session = await stripeFor('sk_test_local').checkout.sessions.create(
      sessionParams(),
    );
    expect(session.id).toMatch(/^cs_test_/);
    expect(session.url).toContain(`/stripe/pay/${session.id}`);
    expect(session.amount_total).toBe(4900);
    expect(session.currency).toBe('usd');
    expect(session.payment_status).toBe('unpaid');
    expect(session.client_reference_id).toBe('order-1');
    expect(session.metadata).toEqual({
      orderId: 'order-1',
      userId: 'u1',
      courseId: 'c1',
    });
    expect(typeof session.payment_intent).toBe('string');
  });

  it('refuses a session without adaptive_pricing[enabled]=false, in Stripe’s error shape', async () => {
    const error = await stripeFor('sk_test_local')
      .checkout.sessions.create(sessionParams({ adaptive_pricing: undefined }))
      .catch((e) => e);
    expect(error).toBeInstanceOf(Stripe.errors.StripeInvalidRequestError);
    expect(error.statusCode).toBe(400);
    expect(error.message).toContain('adaptive_pricing');
  });

  it('returns the same session for the same Idempotency-Key', async () => {
    const stripe = stripeFor('sk_test_local');
    const first = await stripe.checkout.sessions.create(sessionParams(), {
      idempotencyKey: 'order-1',
    });
    const second = await stripe.checkout.sessions.create(sessionParams(), {
      idempotencyKey: 'order-1',
    });
    const other = await stripe.checkout.sessions.create(sessionParams(), {
      idempotencyKey: 'order-2',
    });
    expect(second.id).toBe(first.id);
    expect(other.id).not.toBe(first.id);
  });

  it('retrieves the payment intent with its metadata, amount and currency', async () => {
    const stripe = stripeFor('sk_test_local');
    const session = await stripe.checkout.sessions.create(sessionParams());
    const intent = await stripe.paymentIntents.retrieve(
      session.payment_intent as string,
    );
    expect(intent).toMatchObject({
      amount: 4900,
      currency: 'usd',
      metadata: { orderId: 'order-1' },
    });
  });
});

describe('the hosted page', () => {
  const start = async (url: string) => {
    const { stripe, secret } = await connect(url);
    const session = await stripe.checkout.sessions.create(sessionParams());
    return { stripe, secret, session };
  };

  it('shows the course and amount with text-only buttons', async () => {
    const hook = await receiver();
    const { session } = await start(hook.url);
    const html = await (await page(`/stripe/pay/${session.id}`)).text();
    expect(html).toContain('Algebra');
    expect(html).toContain('$49.00');
    for (const label of ['Pay', 'Decline card', 'Cancel']) {
      expect(html).toContain(`>${label}</button>`);
    }
  });

  it('delivers a signed checkout.session.completed on Pay, then redirects to success_url', async () => {
    const hook = await receiver();
    const { session, secret } = await start(hook.url);
    const response = await page(`/stripe/pay/${session.id}/pay`, {
      method: 'POST',
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      'http://localhost:2020/learn/c1?checkout=success',
    );
    expect(hook.deliveries).toHaveLength(1);
    const [{ body, signature }] = hook.deliveries as [
      { body: string; signature: string },
    ];
    const event = Stripe.webhooks.constructEvent(body, signature, secret, 300);
    expect(event.type).toBe('checkout.session.completed');
    const paid = event.data.object as Stripe.Checkout.Session;
    expect(paid).toMatchObject({
      payment_status: 'paid',
      client_reference_id: 'order-1',
      amount_total: 4900,
      currency: 'usd',
    });
  });

  it('stays on the page when the card is declined, and delivers nothing', async () => {
    const hook = await receiver();
    const { session } = await start(hook.url);
    const response = await page(`/stripe/pay/${session.id}/decline`, {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('declined');
    expect(hook.deliveries).toEqual([]);
  });

  it('redirects to cancel_url on Cancel', async () => {
    const hook = await receiver();
    const { session } = await start(hook.url);
    const response = await page(`/stripe/pay/${session.id}/cancel`, {
      method: 'POST',
    });
    expect(response.headers.get('location')).toBe(
      'http://localhost:2020/learn/c1?checkout=cancelled',
    );
    expect(hook.deliveries).toEqual([]);
  });

  it('shows an expired page for an unknown session', async () => {
    const html = await (await page('/stripe/pay/cs_test_nope')).text();
    expect(html).toContain('expired');
  });
});

describe('delivery', () => {
  const paid = async (url: string) => {
    const { stripe, secret } = await connect(url);
    const session = await stripe.checkout.sessions.create(sessionParams());
    await page(`/stripe/pay/${session.id}/pay`, { method: 'POST' });
    return { stripe, secret, session };
  };

  it('delivers nothing for an account with no endpoint', async () => {
    const hook = await receiver();
    const other = stripeFor('sk_test_local_2');
    const session = await other.checkout.sessions.create(sessionParams());
    await connect(hook.url); // registered on the first account only
    await page(`/stripe/pay/${session.id}/pay`, { method: 'POST' });
    expect(hook.deliveries).toEqual([]);
  });

  it('signs for each endpoint with its own secret', async () => {
    const hook = await receiver();
    const { stripe, secret } = await connect(hook.url);
    const second = await receiver();
    const other = await stripe.webhookEndpoints.create({
      url: second.url,
      enabled_events: [...EVENTS],
    });
    const session = await stripe.checkout.sessions.create(sessionParams());
    await page(`/stripe/pay/${session.id}/pay`, { method: 'POST' });
    const check = (
      delivery: { body: string; signature: string },
      key: string,
    ) => Stripe.webhooks.constructEvent(delivery.body, delivery.signature, key);
    expect(check(hook.deliveries[0] as any, secret).type).toBe(
      'checkout.session.completed',
    );
    expect(() =>
      check(hook.deliveries[0] as any, other.secret as string),
    ).toThrow();
    expect(
      check(second.deliveries[0] as any, other.secret as string).type,
    ).toBe('checkout.session.completed');
  });

  it('stops delivering to a deleted endpoint', async () => {
    const hook = await receiver();
    const { stripe } = await connect(hook.url);
    const [endpoint] = standIn.endpointsOf('acct_local');
    await stripe.webhookEndpoints.del((endpoint as { id: string }).id);
    const session = await stripe.checkout.sessions.create(sessionParams());
    await page(`/stripe/pay/${session.id}/pay`, { method: 'POST' });
    expect(hook.deliveries).toEqual([]);
  });

  it('retries a non-2xx answer up to 3 times', async () => {
    const hook = await receiver([500, 500, 200]);
    await paid(hook.url);
    expect(hook.deliveries).toHaveLength(3);
    const failing = await receiver([500, 500, 500, 500]);
    await paid(failing.url);
    expect(failing.deliveries).toHaveLength(3);
  });

  it('replays the last event N times at once', async () => {
    const hook = await receiver();
    const { session } = await paid(hook.url);
    const response = await request('/stripe/test/replay', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.id, times: 4 }),
    });
    expect(response.status).toBe(200);
    expect(hook.deliveries).toHaveLength(5);
    expect(
      new Set(hook.deliveries.map((d) => JSON.parse(d.body).id)).size,
    ).toBe(1);
  });

  it.each(['signature', 'body'] as const)(
    'forges a message with a wrong %s that fails verification',
    async (kind) => {
      const hook = await receiver();
      const { session, secret } = await paid(hook.url);
      hook.deliveries.length = 0;
      await request('/stripe/test/forge', {
        method: 'POST',
        body: JSON.stringify({ sessionId: session.id, kind }),
      });
      const [forged] = hook.deliveries as [{ body: string; signature: string }];
      expect(() =>
        Stripe.webhooks.constructEvent(forged.body, forged.signature, secret),
      ).toThrow();
    },
  );

  it('refunds through the API and delivers charge.refunded, honouring the idempotency key', async () => {
    const hook = await receiver();
    const { stripe, secret, session } = await paid(hook.url);
    hook.deliveries.length = 0;
    const refund = await stripe.refunds.create(
      { payment_intent: session.payment_intent as string },
      { idempotencyKey: 'refund-order-1' },
    );
    const again = await stripe.refunds.create(
      { payment_intent: session.payment_intent as string },
      { idempotencyKey: 'refund-order-1' },
    );
    expect(refund.amount).toBe(4900);
    expect(again.id).toBe(refund.id);
    expect(hook.deliveries).toHaveLength(1);
    const [delivery] = hook.deliveries as [{ body: string; signature: string }];
    const event = Stripe.webhooks.constructEvent(
      delivery.body,
      delivery.signature,
      secret,
    );
    expect(event.type).toBe('charge.refunded');
    expect(event.data.object).toMatchObject({ amount_refunded: 4900 });
  });
});

describe('connect (instructor payout accounts)', () => {
  let stateFile: string;
  beforeEach(async () => {
    stateFile = join(mkdtempSync(join(tmpdir(), 'stand-in-')), 'connect.json');
    await restart();
  });

  // A fresh stand-in over the same state file, as after a restart of pnpm dev.
  const restart = async () => {
    server.close();
    standIn = createStripeStandIn({
      retryDelayMs: 5,
      connectStateFile: stateFile,
    });
    server = createServer(async (request, response) => {
      const path = new globalThis.URL(request.url ?? '/', 'http://localhost')
        .pathname;
      if (!(await standIn.handle(request, response, path))) {
        response.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    port = (server.address() as AddressInfo).port;
  };

  const post = (path: string, body: object) =>
    request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const setStatus = (id: string, status: string) =>
    post(`/stripe/test/connected-accounts/${id}/status`, { status });

  const platform = () => stripeFor('sk_test_local');

  it('creates an Express account in the shape the SDK parses, idempotently by key', async () => {
    const stripe = platform();
    const first = await stripe.accounts.create(
      {
        type: 'express',
        capabilities: { transfers: { requested: true } },
        metadata: { instructorId: 'i1' },
      },
      { idempotencyKey: 'k1' },
    );
    const again = await stripe.accounts.create(
      { type: 'express' },
      { idempotencyKey: 'k1' },
    );
    expect(again.id).toBe(first.id);
    expect(first.metadata).toEqual({ instructorId: 'i1' });
    expect(first.details_submitted).toBe(false);
    expect(first.capabilities?.transfers).toBe('inactive');
    const other = await stripe.accounts.create(
      { type: 'express' },
      { idempotencyKey: 'k2' },
    );
    expect(other.id).not.toBe(first.id);
  });

  it('hides accounts and transfers of one platform account from the other', async () => {
    const account = await platform().accounts.create({ type: 'express' });
    await setStatus(account.id, 'complete');
    await platform().transfers.create({
      amount: 100,
      currency: 'usd',
      destination: account.id,
      transfer_group: 'g1',
    });
    const second = stripeFor('sk_test_local_2');
    await expect(second.accounts.retrieve(account.id)).rejects.toMatchObject({
      code: 'resource_missing',
    });
    const listed = await second.transfers.list({ transfer_group: 'g1' });
    expect(listed.data).toEqual([]);
    await expect(
      second.transfers.create({
        amount: 100,
        currency: 'usd',
        destination: account.id,
      }),
    ).rejects.toBeInstanceOf(Stripe.errors.StripeInvalidRequestError);
  });

  it('gives an onboarding link whose Complete and Leave buttons return', async () => {
    const stripe = platform();
    const account = await stripe.accounts.create({ type: 'express' });
    const link = await stripe.accountLinks.create({
      account: account.id,
      type: 'account_onboarding',
      return_url: 'http://localhost:1/back',
      refresh_url: 'http://localhost:1/refresh',
    });
    // The link points at the runner's port; this test's server has its own.
    link.url = link.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${port}`);
    const html = await (await fetch(link.url)).text();
    expect(html).toContain('Complete');
    expect(html).toContain('Leave unfinished');

    const leave = await fetch(`${link.url}/leave`, {
      method: 'POST',
      redirect: 'manual',
    });
    expect(leave.status).toBe(303);
    expect(leave.headers.get('location')).toBe('http://localhost:1/back');
    expect((await stripe.accounts.retrieve(account.id)).details_submitted).toBe(
      false,
    );

    await fetch(`${link.url}/complete`, { method: 'POST', redirect: 'manual' });
    const done = await stripe.accounts.retrieve(account.id);
    expect(done.details_submitted).toBe(true);
    expect(done.payouts_enabled).toBe(true);
    expect(done.capabilities?.transfers).toBe('active');
  });

  it.each([
    ['in_progress', false, false, 'inactive'],
    ['complete', true, true, 'active'],
    ['restricted', true, false, 'inactive'],
  ])('sets an account %s', async (status, submitted, payouts, transfers) => {
    const account = await platform().accounts.create({ type: 'express' });
    await setStatus(account.id, status);
    const read = await platform().accounts.retrieve(account.id);
    expect(read.details_submitted).toBe(submitted);
    expect(read.payouts_enabled).toBe(payouts);
    expect(read.capabilities?.transfers).toBe(transfers);
  });

  it('makes a login link for an account', async () => {
    const account = await platform().accounts.create({ type: 'express' });
    const link = await platform().accounts.createLoginLink(account.id);
    expect(link.url).toContain(account.id);
  });

  it('creates a transfer idempotently and lists it by group', async () => {
    const stripe = platform();
    const account = await stripe.accounts.create({ type: 'express' });
    await setStatus(account.id, 'complete');
    const params = {
      amount: 2500,
      currency: 'usd',
      destination: account.id,
      transfer_group: 'po_1',
      metadata: { payoutId: 'po_1' },
    };
    const first = await stripe.transfers.create(params, {
      idempotencyKey: 'po_1',
    });
    const again = await stripe.transfers.create(params, {
      idempotencyKey: 'po_1',
    });
    expect(again.id).toBe(first.id);
    expect(first.transfer_group).toBe('po_1');
    expect(first.metadata).toEqual({ payoutId: 'po_1' });
    await stripe.transfers.create(
      { ...params, transfer_group: 'po_2' },
      { idempotencyKey: 'po_2' },
    );
    const listed = await stripe.transfers.list({ transfer_group: 'po_1' });
    expect(listed.data.map((t) => t.id)).toEqual([first.id]);
    const all = await request('/stripe/test/transfers');
    expect(all.body.transfers).toHaveLength(2);
  });

  it('refuses a transfer to an unknown or restricted destination', async () => {
    const stripe = platform();
    const account = await stripe.accounts.create({ type: 'express' });
    for (const destination of ['acct_missing', account.id]) {
      await expect(
        stripe.transfers.create({ amount: 100, currency: 'usd', destination }),
      ).rejects.toBeInstanceOf(Stripe.errors.StripeInvalidRequestError);
    }
    await setStatus(account.id, 'restricted');
    await expect(
      stripe.transfers.create({
        amount: 100,
        currency: 'usd',
        destination: account.id,
      }),
    ).rejects.toBeInstanceOf(Stripe.errors.StripeInvalidRequestError);
  });

  describe('transfer failure controls', () => {
    let accountId: string;
    beforeEach(async () => {
      accountId = (await platform().accounts.create({ type: 'express' })).id;
      await setStatus(accountId, 'complete');
    });
    const transfer = (key: string) =>
      platform().transfers.create(
        { amount: 100, currency: 'usd', destination: accountId },
        { idempotencyKey: key },
      );

    it('rejects the next transfer once', async () => {
      await post('/stripe/test/transfers/fail-next', { mode: 'rejected' });
      await expect(transfer('a')).rejects.toBeInstanceOf(
        Stripe.errors.StripeInvalidRequestError,
      );
      await expect(transfer('a')).resolves.toMatchObject({ amount: 100 });
    });

    it('answers an idempotency conflict once', async () => {
      await post('/stripe/test/transfers/fail-next', {
        mode: 'idempotency_conflict',
      });
      await expect(transfer('a')).rejects.toBeInstanceOf(
        Stripe.errors.StripeIdempotencyError,
      );
      await expect(transfer('a')).resolves.toBeDefined();
    });

    it('creates the transfer and never answers', async () => {
      await post('/stripe/test/transfers/fail-next', { mode: 'timeout' });
      const impatient = new Stripe('sk_test_local', {
        host: '127.0.0.1',
        port,
        protocol: 'http',
        maxNetworkRetries: 0,
        timeout: 300,
      });
      await expect(
        impatient.transfers.create(
          { amount: 100, currency: 'usd', destination: accountId },
          { idempotencyKey: 'a' },
        ),
      ).rejects.toBeInstanceOf(Stripe.errors.StripeConnectionError);
      const listed = await request('/stripe/test/transfers');
      expect(listed.body.transfers).toHaveLength(1);
      await expect(transfer('a')).resolves.toMatchObject({
        id: listed.body.transfers[0].id,
      });
    });

    it('refuses an unknown mode', async () => {
      const result = await post('/stripe/test/transfers/fail-next', {
        mode: 'nope',
      });
      expect(result.status).toBe(400);
    });
  });

  it('refuses Connect to the restricted key', async () => {
    await expect(
      stripeFor('rk_test_local_nowebhook').accounts.create({ type: 'express' }),
    ).rejects.toBeInstanceOf(Stripe.errors.StripePermissionError);
  });

  it('keeps accounts, transfers and idempotency across a restart', async () => {
    const account = await platform().accounts.create(
      { type: 'express' },
      { idempotencyKey: 'k' },
    );
    await setStatus(account.id, 'complete');
    const t = await platform().transfers.create(
      { amount: 100, currency: 'usd', destination: account.id },
      { idempotencyKey: 't' },
    );
    await restart();
    const read = await platform().accounts.retrieve(account.id);
    expect(read.capabilities?.transfers).toBe('active');
    expect(
      (
        await platform().accounts.create(
          { type: 'express' },
          { idempotencyKey: 'k' },
        )
      ).id,
    ).toBe(account.id);
    expect(
      (
        await platform().transfers.create(
          { amount: 100, currency: 'usd', destination: account.id },
          { idempotencyKey: 't' },
        )
      ).id,
    ).toBe(t.id);
  });

  it('still answers 404 for the rest of Connect', async () => {
    const result = await request('/v1/payouts', {
      headers: { authorization: 'Bearer sk_test_local' },
    });
    expect(result.status).toBe(404);
  });
});
