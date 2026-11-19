/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    send = send;
  },
  GetSecretValueCommand: class {
    type = 'get';
    constructor(readonly input: unknown) {}
  },
  PutSecretValueCommand: class {
    type = 'put';
    constructor(readonly input: unknown) {}
  },
}));

import * as readModule from './secrets.js';
import {
  dropStripeSecretCache,
  getStripeApiKey,
  getStripeWebhookSecret,
  PaymentsNotConnectedError,
} from './secrets.js';
import {
  clearStripeSecrets,
  readStripeApiKey,
  writeStripeSecrets,
} from './secrets-admin.js';

const KEY = 'sk_test_abcdefghijkl';
const SIGNING = 'whsec_abcdefghijkl';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'stripe-secrets-'));
  send.mockReset();
  dropStripeSecretCache();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

const local = () => {
  vi.stubEnv('LOCAL_DEV', 'true');
  vi.stubEnv('LOCAL_SECRETS_DIR', dir);
};
const deployed = () => {
  vi.stubEnv('LOCAL_DEV', undefined);
  vi.stubEnv('STRIPE_API_KEY_SECRET_ARN', 'arn:key');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET_ARN', 'arn:signing');
};

describe('in local dev', () => {
  it('writes and reads the files without calling AWS, and keeps them private', async () => {
    local();
    await writeStripeSecrets({ apiKey: KEY, webhookSecret: SIGNING });

    expect(await getStripeApiKey()).toBe(KEY);
    expect(await getStripeWebhookSecret()).toBe(SIGNING);
    expect(send).not.toHaveBeenCalled();
    for (const file of ['stripe-api-key', 'stripe-webhook-secret']) {
      const { mode } = await stat(path.join(dir, file));
      expect(mode & 0o077).toBe(0);
    }
  });

  it('writes only what it is given', async () => {
    local();
    await writeStripeSecrets({ webhookSecret: SIGNING });
    await expect(getStripeApiKey()).rejects.toBeInstanceOf(
      PaymentsNotConnectedError,
    );
    await writeStripeSecrets({ apiKey: KEY });
    expect(
      await readFile(path.join(dir, 'stripe-webhook-secret'), 'utf8'),
    ).toBe(SIGNING);
  });

  it('says payments are not connected when a file is missing, naming no value', async () => {
    local();
    const error = await getStripeApiKey().catch((e) => e);
    expect(error).toBeInstanceOf(PaymentsNotConnectedError);
    expect(error.message).toMatch(/not connected/);
    expect(error.message).toContain('stripe-api-key');
  });

  it('treats a placeholder, or anything that is not a key, as not connected', async () => {
    local();
    await clearStripeSecrets();
    await expect(getStripeApiKey()).rejects.toBeInstanceOf(
      PaymentsNotConnectedError,
    );
    await expect(getStripeWebhookSecret()).rejects.toBeInstanceOf(
      PaymentsNotConnectedError,
    );
    await writeFile(path.join(dir, 'stripe-api-key'), 'pk_test_publishable');
    const error = await getStripeApiKey().catch((e) => e);
    expect(error).toBeInstanceOf(PaymentsNotConnectedError);
    expect(error.message).not.toContain('pk_test_publishable');
  });

  it('readStripeApiKey returns the key uncached, and nothing for a placeholder', async () => {
    local();
    expect(await readStripeApiKey()).toBeUndefined();
    await writeStripeSecrets({ apiKey: KEY });
    expect(await readStripeApiKey()).toBe(KEY);
    await clearStripeSecrets();
    expect(await readStripeApiKey()).toBeUndefined();
  });
});

describe('deployed', () => {
  it('reads each secret once and caches it for five minutes', async () => {
    deployed();
    vi.useFakeTimers();
    send.mockResolvedValue({ SecretString: KEY });

    expect(await getStripeApiKey()).toBe(KEY);
    expect(await getStripeApiKey()).toBe(KEY);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      type: 'get',
      input: { SecretId: 'arn:key' },
    });

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await getStripeApiKey();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('drops the cache on request', async () => {
    deployed();
    send.mockResolvedValue({ SecretString: SIGNING });
    await getStripeWebhookSecret();
    dropStripeSecretCache();
    await getStripeWebhookSecret();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toMatchObject({
      input: { SecretId: 'arn:signing' },
    });
  });

  it('writes with PutSecretValue, signing secret first, and forgets the cache', async () => {
    deployed();
    send.mockResolvedValue({ SecretString: KEY });
    await getStripeApiKey();
    send.mockResolvedValue({});
    await writeStripeSecrets({ apiKey: KEY, webhookSecret: SIGNING });
    const puts = send.mock.calls.slice(1).map(([command]) => command);
    expect(puts.map((c) => c.type)).toEqual(['put', 'put']);
    expect(puts.map((c) => c.input.SecretId)).toEqual([
      'arn:signing',
      'arn:key',
    ]);
    send.mockResolvedValue({ SecretString: KEY });
    await getStripeApiKey();
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('treats the deployment’s placeholder as not connected', async () => {
    deployed();
    send.mockResolvedValue({ SecretString: 'AbCdEf0123456789generated' });
    await expect(getStripeApiKey()).rejects.toBeInstanceOf(
      PaymentsNotConnectedError,
    );
  });

  it('names the missing variable, never a value', async () => {
    vi.stubEnv('LOCAL_DEV', undefined);
    vi.stubEnv('STRIPE_API_KEY_SECRET_ARN', '');
    const error = await getStripeApiKey().catch((e) => e);
    expect(error.message).toContain('STRIPE_API_KEY_SECRET_ARN');
  });
});

describe('the module checkout and the webhook import', () => {
  it('has no writer', () => {
    expect(Object.keys(readModule).sort()).toEqual([
      'PaymentsNotConnectedError',
      'STRIPE_SECRET_CACHE_MS',
      'dropStripeSecretCache',
      'getStripeApiKey',
      'getStripeWebhookSecret',
      'looksLikeStripeSecret',
    ]);
  });
});
