/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LOCAL_STRIPE } from '@discava/common-server-utils/local-dev';

// Local dev's stand-in for the part of Stripe the platform uses (see
// specs/…/contracts/stripe-stand-in.md), served by the event runner. Backend
// code points the `stripe` SDK at it whenever `isLocalDev()`, as S3 is pointed
// at S3Mock. State is in memory. This is the account and webhook-endpoint
// slice: which accounts a key belongs to, and the endpoints each registers,
// each with a signing secret of its own. Anything else answers 404 in Stripe's
// error shape, so a code path that starts to use more of Stripe fails here
// instead of silently.

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

const id = (prefix: string) => `${prefix}_${randomBytes(12).toString('hex')}`;

export const createStripeStandIn = ({
  log = () => {},
}: {
  log?: (message: string) => void;
} = {}) => {
  const endpoints = new Map<string, Endpoint>();

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
