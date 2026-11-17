/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { verifyUnsubscribeToken } from './unsubscribe-token.js';

export interface UnsubscribeRequest {
  method: string;
  /** The `{token}` path parameter. */
  token: string | undefined;
  query?: Record<string, string | undefined> | null;
  /** Ignored: a one-click POST carries `List-Unsubscribe=One-Click`, the portal's none. */
  body?: unknown;
}

export interface UnsubscribeDeps {
  secret: string;
  setEmailEnabled(
    userId: string,
    type: string,
    enabled: boolean,
  ): Promise<unknown>;
  /** The type's name and email policy, or undefined if it isn't registered. */
  typeInfo(type: string): { name: string; emailPolicy: string } | undefined;
}

export interface UnsubscribeResponse {
  status: number;
  body: { type: string; name: string } | { error: string };
}

const INVALID: UnsubscribeResponse = {
  status: 404,
  body: { error: 'invalid' },
};

/**
 * The public unsubscribe route (`/unsubscribe/{token}`), apart from how a
 * request reaches it. A `GET` only describes the link, so a mail client's
 * link scanner opening it changes nothing; a `POST` switches the type's email
 * off, or on again with `?resubscribe=1`. Writing the same value twice is
 * harmless.
 */
export const handleUnsubscribe = async (
  { method, token, query }: UnsubscribeRequest,
  deps: UnsubscribeDeps,
): Promise<UnsubscribeResponse> => {
  const verified = token
    ? verifyUnsubscribeToken(deps.secret, token)
    : undefined;
  const info = verified ? deps.typeInfo(verified.type) : undefined;
  // A token for a type that is not registered is as good as a forged one.
  if (!verified || !info) {
    return INVALID;
  }
  const { userId, type } = verified;
  const body = { type, name: info.name };
  const verb = method.toUpperCase();
  if (verb === 'GET') {
    if (info.emailPolicy === 'required' || info.emailPolicy === 'never') {
      return { status: 400, body: { error: 'required' } };
    }
    return { status: 200, body };
  }
  if (verb !== 'POST') {
    return { status: 405, body: { error: 'method' } };
  }
  if (info.emailPolicy === 'required' || info.emailPolicy === 'never') {
    return { status: 400, body: { error: 'required' } };
  }
  await deps.setEmailEnabled(userId, type, query?.resubscribe === '1');
  return { status: 200, body };
};
