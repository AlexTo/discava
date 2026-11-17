/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { handleUnsubscribe, type UnsubscribeDeps } from './unsubscribe.js';
import { signUnsubscribeToken } from './unsubscribe-token.js';

const SECRET = 'secret-1';
const TYPES: Record<string, { name: string; emailPolicy: string }> = {
  grade: { name: 'Grades', emailPolicy: 'default-on' },
  news: { name: 'News', emailPolicy: 'default-off' },
  security: { name: 'Security', emailPolicy: 'required' },
};

const setup = () => {
  const setEmailEnabled = vi.fn(async () => undefined);
  const deps: UnsubscribeDeps = {
    secret: SECRET,
    setEmailEnabled,
    typeInfo: (type) => (Object.hasOwn(TYPES, type) ? TYPES[type] : undefined),
  };
  return { deps, setEmailEnabled };
};
const token = (userId = 'user-1', type = 'grade') =>
  signUnsubscribeToken(SECRET, userId, type);

describe('handleUnsubscribe', () => {
  it('describes the link on GET without changing anything', async () => {
    const { deps, setEmailEnabled } = setup();
    expect(
      await handleUnsubscribe({ method: 'GET', token: token() }, deps),
    ).toEqual({ status: 200, body: { type: 'grade', name: 'Grades' } });
    expect(setEmailEnabled).not.toHaveBeenCalled();
  });

  it('turns email off on POST', async () => {
    const { deps, setEmailEnabled } = setup();
    expect(
      await handleUnsubscribe({ method: 'POST', token: token() }, deps),
    ).toEqual({ status: 200, body: { type: 'grade', name: 'Grades' } });
    expect(setEmailEnabled).toHaveBeenCalledExactlyOnceWith(
      'user-1',
      'grade',
      false,
    );
  });

  it('accepts the one-click form body', async () => {
    const { deps, setEmailEnabled } = setup();
    const result = await handleUnsubscribe(
      {
        method: 'POST',
        token: token(),
        body: 'List-Unsubscribe=One-Click',
      },
      deps,
    );
    expect(result.status).toBe(200);
    expect(setEmailEnabled).toHaveBeenCalledWith('user-1', 'grade', false);
  });

  it('is idempotent', async () => {
    const { deps, setEmailEnabled } = setup();
    const first = await handleUnsubscribe(
      { method: 'POST', token: token() },
      deps,
    );
    const second = await handleUnsubscribe(
      { method: 'POST', token: token() },
      deps,
    );
    expect(second).toEqual(first);
    expect(setEmailEnabled.mock.calls).toEqual([
      ['user-1', 'grade', false],
      ['user-1', 'grade', false],
    ]);
  });

  it('turns email back on with resubscribe=1', async () => {
    const { deps, setEmailEnabled } = setup();
    const result = await handleUnsubscribe(
      { method: 'POST', token: token(), query: { resubscribe: '1' } },
      deps,
    );
    expect(result.status).toBe(200);
    expect(setEmailEnabled).toHaveBeenCalledExactlyOnceWith(
      'user-1',
      'grade',
      true,
    );
  });

  describe('an invalid token is 404 for every method and changes nothing', () => {
    const [user, type, signature] = token().split('.');
    const wrongUser = Buffer.from('user-2').toString('base64url');
    const bad: [string, string | undefined][] = [
      ['tampered user', `${wrongUser}.${type}.${signature}`],
      ['tampered type', `${user}.news.${signature}`],
      ['truncated', token().slice(0, -4)],
      [
        'signed with another secret',
        signUnsubscribeToken('other', 'user-1', 'grade'),
      ],
      ['garbage', 'nonsense'],
      ['empty', ''],
      ['missing', undefined],
    ];
    it.each(bad)('%s', async (_name, value) => {
      for (const method of ['GET', 'POST', 'PUT']) {
        const { deps, setEmailEnabled } = setup();
        expect(await handleUnsubscribe({ method, token: value }, deps)).toEqual(
          { status: 404, body: { error: 'invalid' } },
        );
        expect(setEmailEnabled).not.toHaveBeenCalled();
      }
    });
  });

  it('keeps a token for one type from switching off another', async () => {
    const { deps, setEmailEnabled } = setup();
    await handleUnsubscribe(
      { method: 'POST', token: token('user-1', 'news') },
      deps,
    );
    expect(setEmailEnabled).toHaveBeenCalledExactlyOnceWith(
      'user-1',
      'news',
      false,
    );
  });

  it('refuses a required type', async () => {
    const { deps, setEmailEnabled } = setup();
    const result = await handleUnsubscribe(
      { method: 'POST', token: token('user-1', 'security') },
      deps,
    );
    expect(result.status).toBe(400);
    expect(setEmailEnabled).not.toHaveBeenCalled();
  });

  it('refuses an unknown type, even with a valid signature', async () => {
    const { deps, setEmailEnabled } = setup();
    expect(
      await handleUnsubscribe(
        { method: 'POST', token: token('user-1', 'mystery') },
        deps,
      ),
    ).toEqual({ status: 404, body: { error: 'invalid' } });
    expect(setEmailEnabled).not.toHaveBeenCalled();
  });

  it('refuses other methods', async () => {
    const { deps, setEmailEnabled } = setup();
    expect(
      (await handleUnsubscribe({ method: 'DELETE', token: token() }, deps))
        .status,
    ).toBe(405);
    expect(setEmailEnabled).not.toHaveBeenCalled();
  });
});
