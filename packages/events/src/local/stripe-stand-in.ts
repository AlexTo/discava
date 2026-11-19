/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LOCAL_STRIPE } from '@discava/common-server-utils/local-dev';

// Local dev's stand-in for the part of Stripe the platform uses (see
// specs/…/contracts/stripe-stand-in.md), served by the event runner. Backend
// code points the `stripe` SDK at it whenever `isLocalDev()`, as S3 is pointed
// at S3Mock. State is in memory. This is the account and webhook-endpoint
// slice: which accounts a key belongs to, and the endpoints each registers,
// each with a signing secret of its own. Anything else answers 404 in Stripe's
// error shape, so a code path that starts to use more of Stripe fails here
// instead of silently. The rest of the slice is Checkout (sessions, the hosted
// page), payment intents and refunds, and the signed delivery of events to the
// endpoints an account registered.

interface Endpoint {
  id: string;
  accountId: string;
  url: string;
  enabled_events: string[];
  metadata: Record<string, string>;
  api_version: string | null;
  secret: string;
  created: number;
}

interface Session {
  id: string;
  accountId: string;
  title: string;
  amount: number;
  currency: string;
  clientReferenceId: string;
  metadata: Record<string, string>;
  expiresAt: number;
  successUrl: string;
  cancelUrl: string;
  paymentIntentId: string;
  url: string;
  status: 'open' | 'complete' | 'expired';
  paymentStatus: 'unpaid' | 'paid';
  /** The last event delivered for it, so a test can replay it. */
  lastEvent?: StripeEvent;
}

interface PaymentIntent {
  id: string;
  accountId: string;
  metadata: Record<string, string>;
  amount: number;
  currency: string;
  refunded: number;
}

interface StripeEvent {
  id: string;
  object: 'event';
  type: string;
  api_version: string;
  created: number;
  data: { object: Record<string, unknown> };
}

type Form = { [key: string]: string | Form };

// Stripe's form encoding: `metadata[app]=x`, `enabled_events[0]=y`.
const parseForm = (body: string): Form => {
  const form: Form = {};
  for (const [name, value] of new URLSearchParams(body)) {
    const path = name.split(/\[|\]/).filter((part) => part !== '');
    let node = form;
    path.slice(0, -1).forEach((part) => {
      const next = node[part];
      node = typeof next === 'object' ? next : (node[part] = {});
    });
    node[path[path.length - 1] as string] = value;
  }
  return form;
};

const list = (form: Form | string | undefined): string[] =>
  typeof form === 'object'
    ? Object.keys(form)
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => form[key])
        .filter((value): value is string => typeof value === 'string')
    : [];

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
};

const page = (name: string) =>
  readFileSync(new URL(name, import.meta.url), 'utf-8');

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] as string,
  );

const formatAmount = (amount: number, currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).format(
    amount / 100,
  );

const metadataOf = (form: Form | string | undefined) =>
  typeof form === 'object'
    ? Object.fromEntries(
        Object.entries(form).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {};

const id = (prefix: string) => `${prefix}_${randomBytes(12).toString('hex')}`;

// Stripe retries a message that wasn't answered with a 2xx; so does this.
const DELIVERY_ATTEMPTS = 3;

export const createStripeStandIn = ({
  log = () => {},
  retryDelayMs = 500,
}: {
  log?: (message: string) => void;
  retryDelayMs?: number;
} = {}) => {
  const endpoints = new Map<string, Endpoint>();
  const sessions = new Map<string, Session>();
  const intents = new Map<string, PaymentIntent>();
  // What an `Idempotency-Key` already created, by account and key.
  const idempotent = new Map<string, unknown>();
  const origin = `${LOCAL_STRIPE.protocol}://${LOCAL_STRIPE.host}:${LOCAL_STRIPE.port}`;

  const send = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  const error = (
    response: ServerResponse,
    status: number,
    type: string,
    message: string,
    code?: string,
  ) =>
    send(response, status, {
      error: { type, message, ...(code && { code }) },
    });

  // What the key is: one of the two accounts, or the restricted key (which
  // belongs to the first and may not manage webhook endpoints).
  const principal = (request: IncomingMessage) => {
    const key = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
    if (key === LOCAL_STRIPE.restrictedKeyWithoutWebhooks) {
      return {
        accountId: 'acct_local',
        name: 'Local Stripe Account',
        restricted: true,
      };
    }
    const account = key ? LOCAL_STRIPE.accounts[key] : undefined;
    return account
      ? { accountId: account.accountId, name: account.name, restricted: false }
      : undefined;
  };

  const publicEndpoint = (endpoint: Endpoint, withSecret: boolean) => ({
    id: endpoint.id,
    object: 'webhook_endpoint',
    url: endpoint.url,
    enabled_events: endpoint.enabled_events,
    status: 'enabled',
    metadata: endpoint.metadata,
    api_version: endpoint.api_version,
    application: null,
    description: null,
    livemode: false,
    created: endpoint.created,
    ...(withSecret && { secret: endpoint.secret }),
  });

  const sign = (body: string, secret: string) => {
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac('sha256', secret)
      .update(`${t}.${body}`)
      .digest('hex');
    return `t=${t},v1=${v1}`;
  };

  const post = async (url: string, body: string, signature: string) => {
    for (let attempt = 1; ; attempt++) {
      let status = 0;
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'stripe-signature': signature,
          },
          body,
        });
        status = response.status;
      } catch {
        // Unreachable counts as a failed delivery, like a non-2xx.
      }
      if (status >= 200 && status < 300) return status;
      if (attempt >= DELIVERY_ATTEMPTS) return status;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  };

  /**
   * Delivers an event to each endpoint the account registered for its type,
   * signed with that endpoint's own secret. `tamper` sends a signature made
   * for another secret (`signature`) or a body changed after signing (`body`).
   * Answers each delivery's final status; an account with no endpoint gets
   * none, as at Stripe.
   */
  const deliver = async (
    accountId: string,
    event: StripeEvent,
    tamper?: 'signature' | 'body',
  ): Promise<number[]> => {
    const body = JSON.stringify(event);
    return Promise.all(
      [...endpoints.values()]
        .filter(
          (endpoint) =>
            endpoint.accountId === accountId &&
            endpoint.enabled_events.includes(event.type),
        )
        .map((endpoint) => {
          const signature = sign(
            body,
            tamper === 'signature' ? 'whsec_forged' : endpoint.secret,
          );
          const sent =
            tamper === 'body'
              ? JSON.stringify({ ...event, id: `${event.id}_altered` })
              : body;
          log(`stripe: ${event.type} -> ${endpoint.url}`);
          return post(endpoint.url, sent, signature);
        }),
    );
  };

  const newEvent = (
    type: string,
    object: Record<string, unknown>,
  ): StripeEvent => ({
    id: id('evt'),
    object: 'event',
    type,
    api_version: '2026-10-28.endive',
    created: Math.floor(Date.now() / 1000),
    data: { object },
  });

  const sessionObject = (session: Session) => ({
    id: session.id,
    object: 'checkout.session',
    url: session.status === 'open' ? session.url : null,
    expires_at: session.expiresAt,
    status: session.status,
    payment_status: session.paymentStatus,
    client_reference_id: session.clientReferenceId,
    metadata: session.metadata,
    amount_total: session.amount,
    currency: session.currency,
    payment_intent: session.paymentIntentId,
    mode: 'payment',
    livemode: false,
  });

  const intentObject = (intent: PaymentIntent) => ({
    id: intent.id,
    object: 'payment_intent',
    metadata: intent.metadata,
    amount: intent.amount,
    currency: intent.currency,
    status: 'succeeded',
  });

  const notify = (session: Session, type: string) => {
    const event = newEvent(type, sessionObject(session));
    session.lastEvent = event;
    return deliver(session.accountId, event);
  };

  const refundIntent = async (intent: PaymentIntent, amount?: number) => {
    const refunded = Math.min(
      intent.amount,
      intent.refunded + (amount ?? intent.amount),
    );
    intent.refunded = refunded;
    const event = newEvent('charge.refunded', {
      id: `ch_${intent.id.slice(3)}`,
      object: 'charge',
      payment_intent: intent.id,
      amount: intent.amount,
      amount_refunded: refunded,
      currency: intent.currency,
      refunded: refunded >= intent.amount,
      metadata: intent.metadata,
    });
    await deliver(intent.accountId, event);
  };

  const sendHtml = (response: ServerResponse, status: number, html: string) => {
    response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  };
  const redirect = (response: ServerResponse, location: string) => {
    response.writeHead(303, { location });
    response.end();
  };

  const payPage = (session: Session, cardError = '') =>
    page('stripe-pay.html')
      .replaceAll('{{title}}', escapeHtml(session.title))
      .replaceAll(
        '{{amount}}',
        escapeHtml(formatAmount(session.amount, session.currency)),
      )
      .replaceAll('{{error}}', escapeHtml(cardError))
      .replaceAll('{{sessionId}}', escapeHtml(session.id));

  // The hosted page and its three buttons, as a browser reaches them.
  const handleHostedPage = async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
  ): Promise<boolean> => {
    const match = /^\/stripe\/pay\/([^/]+)(?:\/(pay|decline|cancel))?$/.exec(
      path,
    );
    if (!match) return false;
    const session = sessions.get(decodeURIComponent(match[1] as string));
    const action = match[2];
    if (session?.status === 'open' && session.expiresAt * 1000 <= Date.now()) {
      session.status = 'expired';
      await notify(session, 'checkout.session.expired');
    }
    if (!session || session.status !== 'open') {
      sendHtml(response, 200, page('stripe-pay-expired.html'));
      return true;
    }
    if (!action && request.method === 'GET') {
      sendHtml(response, 200, payPage(session));
      return true;
    }
    if (action && request.method === 'POST') {
      await readBody(request);
      if (action === 'cancel')
        return (redirect(response, session.cancelUrl), true);
      if (action === 'decline') {
        sendHtml(response, 200, payPage(session, 'Your card was declined.'));
        return true;
      }
      session.status = 'complete';
      session.paymentStatus = 'paid';
      await notify(session, 'checkout.session.completed');
      redirect(response, session.successUrl);
      return true;
    }
    return false;
  };

  // Controls for e2e and manual use; they exist only here.
  const handleTestControl = async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
  ): Promise<boolean> => {
    if (request.method !== 'POST') return false;
    const control = /^\/stripe\/test\/(replay|forge)$/.exec(path);
    if (!control) return false;
    const input = JSON.parse((await readBody(request)) || '{}') as {
      sessionId?: string;
      times?: number;
      kind?: 'signature' | 'body';
    };
    const session = input.sessionId ? sessions.get(input.sessionId) : undefined;
    if (!session?.lastEvent) {
      error(
        response,
        404,
        'invalid_request_error',
        'No event to deliver for that session',
      );
      return true;
    }
    const event = session.lastEvent;
    const statuses =
      control[1] === 'replay'
        ? (
            await Promise.all(
              Array.from({ length: Math.max(1, input.times ?? 1) }, () =>
                deliver(session.accountId, event),
              ),
            )
          ).flat()
        : await deliver(session.accountId, event, input.kind ?? 'signature');
    send(response, 200, { delivered: statuses });
    return true;
  };

  const handle = async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
  ): Promise<boolean> => {
    if (path === '/stripe/test/endpoints' && request.method === 'GET') {
      // What each account has registered, so a test can prove an old
      // registration was removed. Never a secret.
      const accounts: Record<string, unknown[]> = {};
      for (const { accountId } of Object.values(LOCAL_STRIPE.accounts)) {
        accounts[accountId] = [];
      }
      for (const endpoint of endpoints.values()) {
        accounts[endpoint.accountId]?.push(publicEndpoint(endpoint, false));
      }
      send(response, 200, { accounts });
      return true;
    }
    if (await handleHostedPage(request, response, path)) return true;
    if (await handleTestControl(request, response, path)) return true;
    if (!path.startsWith('/v1/')) return false;

    const who = principal(request);
    if (!who) {
      error(
        response,
        401,
        'invalid_request_error',
        'Invalid API Key provided.',
        'api_key_invalid',
      );
      return true;
    }

    if (path === '/v1/account' && request.method === 'GET') {
      send(response, 200, {
        id: who.accountId,
        object: 'account',
        business_profile: { name: who.name },
        settings: { dashboard: { display_name: who.name } },
      });
      return true;
    }

    if (path === '/v1/checkout/sessions' && request.method === 'POST') {
      const form = parseForm(await readBody(request));
      const adaptive = form.adaptive_pricing;
      const line = typeof form.line_items === 'object' ? form.line_items : {};
      const items = Object.values(line).filter(
        (item): item is Form => typeof item === 'object',
      );
      const price =
        typeof items[0]?.price_data === 'object' ? items[0].price_data : {};
      const product =
        typeof price.product_data === 'object' ? price.product_data : {};
      const amount = Number(price.unit_amount);
      const quantity = Number(items[0]?.quantity ?? 1);
      const problem =
        typeof adaptive !== 'object' || adaptive.enabled !== 'false'
          ? 'adaptive_pricing[enabled] must be false'
          : form.mode !== 'payment'
            ? 'mode must be payment'
            : items.length !== 1
              ? 'exactly one line item is needed'
              : !Number.isInteger(amount) ||
                  amount <= 0 ||
                  typeof price.currency !== 'string' ||
                  typeof product.name !== 'string'
                ? 'the line item needs a currency, a unit_amount and a product name'
                : typeof form.client_reference_id !== 'string' ||
                    typeof form.success_url !== 'string' ||
                    typeof form.cancel_url !== 'string' ||
                    !/^\d+$/.test(String(form.expires_at))
                  ? 'client_reference_id, success_url, cancel_url and expires_at are needed'
                  : undefined;
      if (problem) {
        error(
          response,
          400,
          'invalid_request_error',
          `Invalid request: ${problem}.`,
          'parameter_invalid_empty',
        );
        return true;
      }
      const key = request.headers['idempotency-key'];
      const slot =
        typeof key === 'string' ? `${who.accountId}:${key}` : undefined;
      const known = slot
        ? (idempotent.get(slot) as Session | undefined)
        : undefined;
      if (known) {
        send(response, 200, sessionObject(known));
        return true;
      }
      const sessionId = id('cs_test');
      const intentId = id('pi');
      const session: Session = {
        id: sessionId,
        accountId: who.accountId,
        title: product.name as string,
        amount: amount * quantity,
        currency: String(price.currency).toLowerCase(),
        clientReferenceId: form.client_reference_id as string,
        metadata: metadataOf(form.metadata),
        expiresAt: Number(form.expires_at),
        successUrl: form.success_url as string,
        cancelUrl: form.cancel_url as string,
        paymentIntentId: intentId,
        url: `${origin}/stripe/pay/${sessionId}`,
        status: 'open',
        paymentStatus: 'unpaid',
      };
      sessions.set(sessionId, session);
      const intentData =
        typeof form.payment_intent_data === 'object'
          ? form.payment_intent_data
          : {};
      intents.set(intentId, {
        id: intentId,
        accountId: who.accountId,
        metadata: metadataOf(intentData.metadata),
        amount: session.amount,
        currency: session.currency,
        refunded: 0,
      });
      if (slot) idempotent.set(slot, session);
      send(response, 200, sessionObject(session));
      return true;
    }

    const intentMatch = /^\/v1\/payment_intents\/([^/]+)$/.exec(path);
    if (intentMatch && request.method === 'GET') {
      const intent = intents.get(decodeURIComponent(intentMatch[1] as string));
      if (!intent || intent.accountId !== who.accountId) {
        error(
          response,
          404,
          'invalid_request_error',
          `No such payment_intent: '${intentMatch[1]}'`,
          'resource_missing',
        );
        return true;
      }
      send(response, 200, intentObject(intent));
      return true;
    }

    if (path === '/v1/refunds' && request.method === 'POST') {
      const form = parseForm(await readBody(request));
      const intent =
        typeof form.payment_intent === 'string'
          ? intents.get(form.payment_intent)
          : undefined;
      if (!intent || intent.accountId !== who.accountId) {
        error(
          response,
          404,
          'invalid_request_error',
          'No such payment_intent',
          'resource_missing',
        );
        return true;
      }
      const key = request.headers['idempotency-key'];
      const slot =
        typeof key === 'string' ? `${who.accountId}:${key}` : undefined;
      const known = slot ? idempotent.get(slot) : undefined;
      if (known) {
        send(response, 200, known);
        return true;
      }
      const amount =
        typeof form.amount === 'string' ? Number(form.amount) : undefined;
      if (
        amount !== undefined &&
        (!Number.isInteger(amount) ||
          amount <= 0 ||
          amount > intent.amount - intent.refunded)
      ) {
        error(
          response,
          400,
          'invalid_request_error',
          'Refund amount is invalid or exceeds the charge.',
          'parameter_invalid_integer',
        );
        return true;
      }
      const refund = {
        id: id('re'),
        object: 'refund',
        payment_intent: intent.id,
        amount: amount ?? intent.amount - intent.refunded,
        currency: intent.currency,
        status: 'succeeded',
      };
      if (slot) idempotent.set(slot, refund);
      send(response, 200, refund);
      await refundIntent(intent, refund.amount);
      return true;
    }

    if (path === '/v1/webhook_endpoints') {
      if (who.restricted) {
        error(
          response,
          403,
          'invalid_request_error',
          'The provided key does not have the required permissions for this endpoint.',
          'permission_denied',
        );
        return true;
      }
      if (request.method === 'POST') {
        const form = parseForm(await readBody(request));
        const url = typeof form.url === 'string' ? form.url : '';
        const events = list(form.enabled_events);
        if (!/^https?:\/\/.+/.test(url) || events.length === 0) {
          error(
            response,
            400,
            'invalid_request_error',
            'A valid url and at least one of enabled_events are required.',
            'parameter_missing',
          );
          return true;
        }
        const endpoint: Endpoint = {
          id: id('we'),
          accountId: who.accountId,
          url,
          enabled_events: events,
          metadata:
            typeof form.metadata === 'object'
              ? Object.fromEntries(
                  Object.entries(form.metadata).filter(
                    (entry): entry is [string, string] =>
                      typeof entry[1] === 'string',
                  ),
                )
              : {},
          api_version:
            typeof form.api_version === 'string' ? form.api_version : null,
          secret: `whsec_${randomBytes(24).toString('hex')}`,
          created: Math.floor(Date.now() / 1000),
        };
        endpoints.set(endpoint.id, endpoint);
        log(`stripe: ${who.accountId} registered ${endpoint.id} at ${url}`);
        // The signing secret is only in this response, as with Stripe.
        send(response, 200, publicEndpoint(endpoint, true));
        return true;
      }
      if (request.method === 'GET') {
        send(response, 200, {
          object: 'list',
          url: '/v1/webhook_endpoints',
          has_more: false,
          data: [...endpoints.values()]
            .filter((endpoint) => endpoint.accountId === who.accountId)
            .map((endpoint) => publicEndpoint(endpoint, false)),
        });
        return true;
      }
    }

    const one = /^\/v1\/webhook_endpoints\/([^/]+)$/.exec(path);
    if (one && request.method === 'DELETE') {
      const endpoint = endpoints.get(decodeURIComponent(one[1] as string));
      if (who.restricted || !endpoint || endpoint.accountId !== who.accountId) {
        who.restricted
          ? error(
              response,
              403,
              'invalid_request_error',
              'The provided key does not have the required permissions for this endpoint.',
              'permission_denied',
            )
          : error(
              response,
              404,
              'invalid_request_error',
              `No such webhook endpoint: '${one[1]}'`,
              'resource_missing',
            );
        return true;
      }
      endpoints.delete(endpoint.id);
      log(`stripe: ${who.accountId} removed ${endpoint.id}`);
      send(response, 200, {
        id: endpoint.id,
        object: 'webhook_endpoint',
        deleted: true,
      });
      return true;
    }

    error(
      response,
      404,
      'invalid_request_error',
      `Unrecognized request URL (${request.method}: ${path}). The Stripe stand-in implements only part of the API.`,
    );
    return true;
  };

  return {
    handle,
    /** The endpoints an account has registered, with their signing secrets. */
    endpointsOf: (accountId: string) =>
      [...endpoints.values()].filter((e) => e.accountId === accountId),
  };
};

export type StripeStandIn = ReturnType<typeof createStripeStandIn>;
