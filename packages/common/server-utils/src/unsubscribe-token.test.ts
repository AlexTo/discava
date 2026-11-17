/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_UNSUBSCRIBE_SECRET } from './local-dev.js';
import {
  resolveUnsubscribeSecret,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from './unsubscribe-token.js';

const SECRET = 'secret-1';

describe('unsubscribe tokens', () => {
  it('round trips', () => {
    const token = signUnsubscribeToken(SECRET, 'user-1', 'grade');
    expect(verifyUnsubscribeToken(SECRET, token)).toEqual({
      userId: 'user-1',
      type: 'grade',
    });
  });

  it('refuses a tampered user', () => {
    const [, type, signature] = signUnsubscribeToken(
      SECRET,
      'user-1',
      'grade',
    ).split('.');
    const user = Buffer.from('user-2').toString('base64url');
    expect(
      verifyUnsubscribeToken(SECRET, `${user}.${type}.${signature}`),
    ).toBeUndefined();
  });

  it('refuses a tampered type', () => {
    const [user, , signature] = signUnsubscribeToken(
      SECRET,
      'user-1',
      'grade',
    ).split('.');
    expect(
      verifyUnsubscribeToken(SECRET, `${user}.other.${signature}`),
    ).toBeUndefined();
  });

  it('refuses a truncated token', () => {
    const token = signUnsubscribeToken(SECRET, 'user-1', 'grade');
    expect(verifyUnsubscribeToken(SECRET, token.slice(0, -4))).toBeUndefined();
    expect(verifyUnsubscribeToken(SECRET, 'a.b')).toBeUndefined();
    expect(verifyUnsubscribeToken(SECRET, '')).toBeUndefined();
  });

  it('refuses extra segments', () => {
    const token = signUnsubscribeToken(SECRET, 'user-1', 'grade');
    expect(verifyUnsubscribeToken(SECRET, `${token}.x`)).toBeUndefined();
  });

  it('refuses a wrong secret', () => {
    const token = signUnsubscribeToken(SECRET, 'user-1', 'grade');
    expect(verifyUnsubscribeToken('other', token)).toBeUndefined();
  });

  it('refuses to sign a type containing a dot', () => {
    expect(() => signUnsubscribeToken(SECRET, 'user-1', 'a.b')).toThrow();
  });
});

describe('resolveUnsubscribeSecret', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the fixed constant in local dev', async () => {
    vi.stubEnv('LOCAL_DEV', 'true');
    await expect(resolveUnsubscribeSecret()).resolves.toBe(
      LOCAL_UNSUBSCRIBE_SECRET,
    );
  });
});
