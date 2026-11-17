/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getSecret } from '@aws-lambda-powertools/parameters/secrets';
import { isLocalDev, LOCAL_UNSUBSCRIBE_SECRET } from './local-dev.js';

// `<base64url(userId)>.<type>.<base64url(HMAC-SHA256(secret, userId + "\n" + type))>`.
// No expiry: an unsubscribe link in an old email must keep working.
const sign = (secret: string, userId: string, type: string): Buffer =>
  createHmac('sha256', secret).update(`${userId}\n${type}`).digest();

export const signUnsubscribeToken = (
  secret: string,
  userId: string,
  type: string,
): string => {
  if (type === '') {
    throw new Error(`Invalid notification type for a token: ${type}`);
  }
  return [
    Buffer.from(userId).toString('base64url'),
    type,
    sign(secret, userId, type).toString('base64url'),
  ].join('.');
};

/** The token's user and type, or undefined if it isn't one we signed. */
export const verifyUnsubscribeToken = (
  secret: string,
  token: string,
): { userId: string; type: string } | undefined => {
  // The user and signature are base64url, which has no dot; the type, an
  // id such as 'assignment.returned', may.
  const first = token.indexOf('.');
  const last = token.lastIndexOf('.');
  if (first <= 0 || last <= first + 1 || last === token.length - 1) {
    return undefined;
  }
  const encodedUser = token.slice(0, first);
  const type = token.slice(first + 1, last);
  const encodedSignature = token.slice(last + 1);
  const userId = Buffer.from(encodedUser, 'base64url').toString();
  const expected = sign(secret, userId, type);
  const actual = Buffer.from(encodedSignature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return undefined;
  }
  return { userId, type };
};

let _secret: Promise<string> | undefined;

/**
 * The signing secret: the Secrets Manager secret named by
 * `UNSUBSCRIBE_SECRET_ARN`, read once per container, or a fixed constant in
 * local dev.
 */
export const resolveUnsubscribeSecret = (): Promise<string> => {
  if (isLocalDev()) {
    return Promise.resolve(LOCAL_UNSUBSCRIBE_SECRET);
  }
  if (!_secret) {
    const arn = process.env.UNSUBSCRIBE_SECRET_ARN;
    if (!arn) {
      return Promise.reject(new Error('UNSUBSCRIBE_SECRET_ARN is not set'));
    }
    _secret = getSecret(arn).then((value) => {
      if (typeof value !== 'string' || value === '') {
        throw new Error('The unsubscribe secret is empty');
      }
      return value;
    });
    // Don't cache a failure.
    _secret.catch(() => {
      _secret = undefined;
    });
  }
  return _secret;
};
