/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node

import type { UnsubscribeDeps } from '@discava/common-server-utils/unsubscribe';
import { signUnsubscribeToken } from '@discava/common-server-utils/unsubscribe-token';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notificationUnsubscribe } from './notification-unsubscribe.js';

const SECRET = 'secret-1';
const setEmailEnabled = vi.fn(async () => undefined);
const deps: UnsubscribeDeps = {
  secret: SECRET,
  setEmailEnabled,
  typeInfo: (type) =>
    type === 'grade'
      ? { name: 'Grades', emailPolicy: 'default-on' }
      : undefined,
};
const token = signUnsubscribeToken(SECRET, 'user-1', 'grade');
const event = (over: Record<string, unknown> = {}) => ({
  httpMethod: 'POST',
  pathParameters: { token },
  queryStringParameters: null,
  body: null,
  ...over,
});

afterEach(() => {
  vi.unstubAllEnvs();
  setEmailEnabled.mockClear();
});

describe('notificationUnsubscribe', () => {
  it('describes the link on GET without writing', async () => {
    const result = await notificationUnsubscribe(
      event({ httpMethod: 'GET' }),
      deps,
    );
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ type: 'grade', name: 'Grades' });
    expect(setEmailEnabled).not.toHaveBeenCalled();
  });

  it('switches email off on POST', async () => {
    const result = await notificationUnsubscribe(event(), deps);
    expect(result.statusCode).toBe(200);
    expect(setEmailEnabled).toHaveBeenCalledWith('user-1', 'grade', false);
  });

  it('decodes a base64 one-click form body', async () => {
    const result = await notificationUnsubscribe(
      event({
        body: Buffer.from('List-Unsubscribe=One-Click').toString('base64'),
        isBase64Encoded: true,
      }),
      deps,
    );
    expect(result.statusCode).toBe(200);
    expect(setEmailEnabled).toHaveBeenCalledWith('user-1', 'grade', false);
  });

  it('resubscribes with ?resubscribe=1', async () => {
    await notificationUnsubscribe(
      event({ queryStringParameters: { resubscribe: '1' } }),
      deps,
    );
    expect(setEmailEnabled).toHaveBeenCalledWith('user-1', 'grade', true);
  });

  it('answers an invalid token with 404 and no write', async () => {
    const result = await notificationUnsubscribe(
      event({ pathParameters: { token: 'bogus' } }),
      deps,
    );
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ error: 'invalid' });
    expect(setEmailEnabled).not.toHaveBeenCalled();
  });

  it('answers a missing path parameter with 404', async () => {
    const result = await notificationUnsubscribe(
      event({ pathParameters: null }),
      deps,
    );
    expect(result.statusCode).toBe(404);
  });

  it('sends JSON and the student portal origin as the CORS origin', async () => {
    vi.stubEnv('STUDENT_PORTAL_URL', 'https://learn.example.com/');
    const { headers } = await notificationUnsubscribe(event(), deps);
    expect(headers).toMatchObject({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'https://learn.example.com',
      'Access-Control-Allow-Methods': 'GET,POST',
    });
  });

  it('sends no CORS origin when none is configured', async () => {
    vi.stubEnv('STUDENT_PORTAL_URL', '');
    const { headers } = await notificationUnsubscribe(event(), deps);
    expect(headers).not.toHaveProperty('Access-Control-Allow-Origin');
  });

  it('answers 500 when the write fails', async () => {
    setEmailEnabled.mockRejectedValueOnce(new Error('boom'));
    const result = await notificationUnsubscribe(event(), deps);
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toEqual({ error: 'internal' });
  });
});
