/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_STRIPE } from '@discava/common-server-utils/local-dev';

// Local dev's stand-in for the part of Stripe the platform uses (see
// specs/…/contracts/stripe-stand-in.md), served by the event runner. Backend
// code points the `stripe` SDK at it whenever `isLocalDev()`, as S3 is pointed
// at S3Mock. State is in memory. This is the account and webhook-endpoint
// slice: which accounts a key belongs to, and the endpoints each registers,
// each with a signing secret of its own. Anything else answers 404 in Stripe's
// error shape, so a code path that starts to use more of Stripe fails here
// instead of silently. The Connect slice (Express accounts, onboarding links,
// transfers) keeps its state in a file, so a restart of `pnpm dev` doesn't
// strand stored payout accounts. The rest of the slice is Checkout (sessions, the hosted
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

type ConnectedStatus = 'in_progress' | 'complete' | 'restricted';

interface ConnectedAccount {
  id: string;
  /** The platform account whose key created it: the only one that sees it. */
  platformAccountId: string;
  status: ConnectedStatus;
  metadata: Record<string, string>;
  created: number;
}

interface Transfer {
  id: string;
  platformAccountId: string;
  amount: number;
  currency: string;
  destination: string;
  transfer_group: string | null;
  metadata: Record<string, string>;
  created: number;
}

type TransferFailure = 'rejected' | 'idempotency_conflict' | 'timeout';

interface ConnectState {
  accounts: Record<string, ConnectedAccount>;
  transfers: Transfer[];
  /** Idempotency keys already used, by platform account and key. */
  keys: Record<string, { kind: 'account' | 'transfer'; id: string }>;
  /** Onboarding link tokens and where each returns to. */
  links: Record<string, { accountId: string; returnUrl: string }>;
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

const DEFAULT_CONNECT_STATE_FILE = new URL(
  '../../../../tmp/local-dev/stripe-connect.json',
  import.meta.url,
);

export const createStripeStandIn = ({
  log = () => {},
  retryDelayMs = 500,
  connectStateFile = DEFAULT_CONNECT_STATE_FILE,
}: {
  log?: (message: string) => void;
  retryDelayMs?: number;
  /** Where connected accounts and transfers are kept between restarts. */
  connectStateFile?: URL | string;
} = {}) => {
  const endpoints = new Map<string, Endpoint>();
  const sessions = new Map<string, Session>();
  const intents = new Map<string, PaymentIntent>();
  // What an `Idempotency-Key` already created, by account and key.
  const idempotent = new Map<string, unknown>();
  const connectPath =
    typeof connectStateFile === 'string'
      ? connectStateFile
      : fileURLToPath(connectStateFile);
  const loadConnect = (): ConnectState => {
    try {
      return {
        accounts: {},
        transfers: [],
        keys: {},
        links: {},
        ...JSON.parse(readFileSync(connectPath, 'utf-8')),
      };
    } catch {
      return { accounts: {}, transfers: [], keys: {}, links: {} };
    }
  };
  const connect = loadConnect();
  const saveConnect = () => {
    mkdirSync(dirname(connectPath), { recursive: true });
    writeFileSync(connectPath, JSON.stringify(connect, null, 2));
  };
  // What the next transfer request does instead of succeeding, once.
  let nextTransferFailure: TransferFailure | undefined;
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

  const connectedObject = (account: ConnectedAccount) => {
    const complete = account.status === 'complete';
    return {
      id: account.id,
      object: 'account',
      type: 'express',
      created: account.created,
      metadata: account.metadata,
      details_submitted: account.status !== 'in_progress',
      payouts_enabled: complete,
      charges_enabled: false,
      capabilities: { transfers: complete ? 'active' : 'inactive' },
    };
  };

  const transferObject = (transfer: Transfer) => ({
    ...transfer,
    object: 'transfer',
    platformAccountId: undefined,
    livemode: false,
    reversed: false,
  });

  const notFound = (
    response: ServerResponse,
    what: string,
    idValue: string | undefined,
  ) =>
    error(
      response,
      404,
      'invalid_request_error',
      `No such ${what}: '${idValue}'`,
      'resource_missing',
    );

  // The onboarding page a link opens, and its two buttons.
  const handleOnboardingPage = async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
  ): Promise<boolean> => {
    if (path.startsWith('/stripe/connect/dashboard/')) {
      sendHtml(response, 200, '<h1>Stripe Express dashboard (local)</h1>');
      return true;
    }
    const match =
      /^\/stripe\/connect\/onboard\/([^/]+)(?:\/(complete|leave))?$/.exec(path);
    if (!match) return false;
    const link = connect.links[decodeURIComponent(match[1] as string)];
    const account = link ? connect.accounts[link.accountId] : undefined;
    if (!link || !account) {
      sendHtml(
        response,
        200,
        '<p>This onboarding link is no longer valid.</p>',
      );
      return true;
    }
    const action = match[2];
    if (!action && request.method === 'GET') {
      sendHtml(
        response,
        200,
        `<!doctype html><title>Stripe onboarding</title><h1>Stripe Express onboarding (local)</h1><p>Account ${escapeHtml(account.id)}</p>` +
          ['complete', 'leave']
            .map(
              (name) =>
                `<form method="post" action="${escapeHtml(path)}/${name}"><button type="submit">${name === 'complete' ? 'Complete' : 'Leave unfinished'}</button></form>`,
            )
            .join(''),
      );
      return true;
    }
    if (action && request.method === 'POST') {
      await readBody(request);
      if (action === 'complete') {
        account.status = 'complete';
        saveConnect();
      }
      redirect(response, link.returnUrl);
      return true;
    }
    return false;
  };

  // Controls for e2e and manual use; they exist only here.
  const handleConnectControl = async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
  ): Promise<boolean> => {
    if (path === '/stripe/test/transfers' && request.method === 'GET') {
      send(response, 200, { transfers: connect.transfers });
      return true;
    }
    if (request.method !== 'POST') return false;
    const status = /^\/stripe\/test\/connected-accounts\/([^/]+)\/status$/.exec(
      path,
    );
    if (status) {
      const input = JSON.parse((await readBody(request)) || '{}') as {
        status?: ConnectedStatus;
      };
      const account = connect.accounts[decodeURIComponent(status[1] as string)];
      if (
        !account ||
        !['in_progress', 'complete', 'restricted'].includes(input.status ?? '')
      ) {
        notFound(response, 'account', status[1]);
        return true;
      }
      account.status = input.status as ConnectedStatus;
      saveConnect();
      send(response, 200, connectedObject(account));
      return true;
    }
    if (path === '/stripe/test/transfers/fail-next') {
      const input = JSON.parse((await readBody(request)) || '{}') as {
        mode?: TransferFailure;
      };
      if (
        !['rejected', 'idempotency_conflict', 'timeout'].includes(
          input.mode ?? '',
        )
      ) {
        error(response, 400, 'invalid_request_error', 'Unknown failure mode');
        return true;
      }
      nextTransferFailure = input.mode;
      send(response, 200, { next: nextTransferFailure });
      return true;
    }
    return false;
  };

  // The Connect slice of /v1: accounts, account links, login links and
  // transfers, each visible only to the platform account whose key made it.
  const handleConnect = async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    who: { accountId: string; restricted: boolean },
  ): Promise<boolean> => {
    const isConnect =
      path === '/v1/accounts' ||
      path === '/v1/account_links' ||
      path === '/v1/transfers' ||
      /^\/v1\/accounts\/[^/]+(?:\/login_links)?$/.test(path);
    if (!isConnect) return false;
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
    const key = request.headers['idempotency-key'];
    const slot =
      typeof key === 'string' ? `${who.accountId}:${key}` : undefined;
    const owned = (accountId: string | undefined) => {
      const account = accountId ? connect.accounts[accountId] : undefined;
      return account?.platformAccountId === who.accountId ? account : undefined;
    };

    if (path === '/v1/accounts' && request.method === 'POST') {
      const form = parseForm(await readBody(request));
      const known = slot ? connect.keys[slot] : undefined;
      const existing = known?.kind === 'account' ? owned(known.id) : undefined;
      if (existing) {
        send(response, 200, connectedObject(existing));
        return true;
      }
      if (form.type !== 'express') {
        error(
          response,
          400,
          'invalid_request_error',
          'Only Express accounts are supported here.',
          'parameter_invalid_enum',
        );
        return true;
      }
      const account: ConnectedAccount = {
        id: id('acct'),
        platformAccountId: who.accountId,
        status: 'in_progress',
        metadata: metadataOf(form.metadata),
        created: Math.floor(Date.now() / 1000),
      };
      connect.accounts[account.id] = account;
      if (slot) connect.keys[slot] = { kind: 'account', id: account.id };
      saveConnect();
      log(`stripe: ${who.accountId} created ${account.id}`);
      send(response, 200, connectedObject(account));
      return true;
    }

    const one = /^\/v1\/accounts\/([^/]+)$/.exec(path);
    if (one && request.method === 'GET') {
      const account = owned(decodeURIComponent(one[1] as string));
      if (!account) notFound(response, 'account', one[1]);
      else send(response, 200, connectedObject(account));
      return true;
    }

    const login = /^\/v1\/accounts\/([^/]+)\/login_links$/.exec(path);
    if (login && request.method === 'POST') {
      const account = owned(decodeURIComponent(login[1] as string));
      if (!account) notFound(response, 'account', login[1]);
      else
        send(response, 200, {
          object: 'login_link',
          created: Math.floor(Date.now() / 1000),
          url: `${origin}/stripe/connect/dashboard/${account.id}`,
        });
      return true;
    }

    if (path === '/v1/account_links' && request.method === 'POST') {
      const form = parseForm(await readBody(request));
      const account = owned(
        typeof form.account === 'string' ? form.account : undefined,
      );
      if (!account) {
        notFound(response, 'account', String(form.account));
        return true;
      }
      if (
        form.type !== 'account_onboarding' ||
        typeof form.return_url !== 'string' ||
        typeof form.refresh_url !== 'string'
      ) {
        error(
          response,
          400,
          'invalid_request_error',
          'type, return_url and refresh_url are needed.',
          'parameter_missing',
        );
        return true;
      }
      const token = id('link');
      connect.links[token] = {
        accountId: account.id,
        returnUrl: form.return_url,
      };
      saveConnect();
      const created = Math.floor(Date.now() / 1000);
      send(response, 200, {
        object: 'account_link',
        created,
        expires_at: created + 300,
        url: `${origin}/stripe/connect/onboard/${token}`,
      });
      return true;
    }

    if (path === '/v1/transfers' && request.method === 'POST') {
      const form = parseForm(await readBody(request));
      const known = slot ? connect.keys[slot] : undefined;
      const replay =
        known?.kind === 'transfer'
          ? connect.transfers.find((t) => t.id === known.id)
          : undefined;
      if (replay) {
        send(response, 200, transferObject(replay));
        return true;
      }
      const failure = nextTransferFailure;
      nextTransferFailure = undefined;
      if (failure === 'rejected') {
        error(
          response,
          400,
          'invalid_request_error',
          'Your platform balance is too low to make this transfer.',
          'balance_insufficient',
        );
        return true;
      }
      if (failure === 'idempotency_conflict') {
        error(
          response,
          400,
          'idempotency_error',
          'There is currently another in-progress request using this Stripe-Idempotency-Key.',
          'idempotency_key_in_use',
        );
        return true;
      }
      const destination = owned(
        typeof form.destination === 'string' ? form.destination : undefined,
      );
      const amount = Number(form.amount);
      if (
        !destination ||
        destination.status !== 'complete' ||
        !Number.isInteger(amount) ||
        amount <= 0 ||
        typeof form.currency !== 'string'
      ) {
        error(
          response,
          400,
          'invalid_request_error',
          !destination
            ? `No such destination: '${String(form.destination)}'`
            : destination.status !== 'complete'
              ? 'Your destination account needs to have the transfers capability enabled.'
              : 'A positive integer amount and a currency are needed.',
          'parameter_invalid_empty',
        );
        return true;
      }
      const transfer: Transfer = {
        id: id('tr'),
        platformAccountId: who.accountId,
        amount,
        currency: form.currency.toLowerCase(),
        destination: destination.id,
        transfer_group:
          typeof form.transfer_group === 'string' ? form.transfer_group : null,
        metadata: metadataOf(form.metadata),
        created: Math.floor(Date.now() / 1000),
      };
      connect.transfers.push(transfer);
      if (slot) connect.keys[slot] = { kind: 'transfer', id: transfer.id };
      saveConnect();
      log(
        `stripe: ${who.accountId} transferred ${amount} to ${destination.id}`,
      );
      if (failure === 'timeout') {
        // Created, but never answered: the caller's request times out.
        return true;
      }
      send(response, 200, transferObject(transfer));
      return true;
    }

    if (path === '/v1/transfers' && request.method === 'GET') {
      const group = new URL(request.url ?? '', origin).searchParams.get(
        'transfer_group',
      );
      send(response, 200, {
        object: 'list',
        url: '/v1/transfers',
        has_more: false,
        data: connect.transfers
          .filter(
            (t) =>
              t.platformAccountId === who.accountId &&
              (group === null || t.transfer_group === group),
          )
          .map(transferObject),
      });
      return true;
    }
    return false;
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
    if (await handleOnboardingPage(request, response, path)) return true;
    if (await handleConnectControl(request, response, path)) return true;
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

    if (await handleConnect(request, response, path, who)) return true;

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
