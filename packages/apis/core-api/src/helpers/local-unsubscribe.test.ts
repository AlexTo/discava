/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LOCAL_UNSUBSCRIBE_SECRET } from '@discava/common-server-utils/local-dev';
import { signUnsubscribeToken } from '@discava/common-server-utils/unsubscribe-token';
import {
  NOTIFICATION_TYPES,
  setNotificationPreference,
} from '@discava/core-table';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { unsubscribeMiddleware } from './local-unsubscribe.js';

const puts: Record<string, unknown>[] = [];
const service = {
  entities: {
    notificationPreference: {
      put: (item: Record<string, unknown>) => ({
        go: async () => {
          puts.push(item);
          return { data: item };
        },
      }),
    },
  },
} as any;

const ORIGIN = 'http://localhost:4201';
const TYPE = Object.values(NOTIFICATION_TYPES).find(
  (t) => t.emailPolicy === 'default-on',
)!;
const token = signUnsubscribeToken(LOCAL_UNSUBSCRIBE_SECRET, 'user-1', TYPE.id);

let server: Server;
let base: string;
beforeAll(async () => {
  const middleware = unsubscribeMiddleware(
    async () => ({
      secret: LOCAL_UNSUBSCRIBE_SECRET,
      setEmailEnabled: (userId, type, enabled) =>
        setNotificationPreference(service, userId, type, enabled),
      typeInfo: (type) =>
        Object.hasOwn(NOTIFICATION_TYPES, type)
          ? NOTIFICATION_TYPES[type]
          : undefined,
    }),
    ORIGIN,
  );
  server = createServer((req, res) =>
    middleware(req, res, () => {
      res.writeHead(418).end('next');
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});
beforeEach(() => {
  puts.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('the local unsubscribe route', () => {
  it('changes nothing on GET', async () => {
    const response = await fetch(`${base}/unsubscribe/${token}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ type: TYPE.id, name: TYPE.name });
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(puts).toEqual([]);
  });

  it('writes emailEnabled: false on POST', async () => {
    const response = await fetch(`${base}/unsubscribe/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    });
    expect(response.status).toBe(200);
    expect(puts).toEqual([
      { userId: 'user-1', type: TYPE.id, emailEnabled: false },
    ]);
  });

  it('writes emailEnabled: true on POST with resubscribe=1', async () => {
    await fetch(`${base}/unsubscribe/${token}?resubscribe=1`, {
      method: 'POST',
    });
    expect(puts).toEqual([
      { userId: 'user-1', type: TYPE.id, emailEnabled: true },
    ]);
  });

  it('answers an invalid token with 404 and writes nothing', async () => {
    const response = await fetch(`${base}/unsubscribe/nope`, {
      method: 'POST',
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'invalid' });
    expect(puts).toEqual([]);
  });

  it('passes other paths on', async () => {
    expect((await fetch(`${base}/notification.list`)).status).toBe(418);
  });
});
