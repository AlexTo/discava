/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { connectPayment, disconnectPayment, paymentStatus } from './payment.js';

const mocks = vi.hoisted(() => ({
  getConnection: vi.fn(),
  beginChange: vi.fn(),
  completeConnection: vi.fn(),
  completeDisconnect: vi.fn(),
  rotateKey: vi.fn(),
  abandonChange: vi.fn(),
  recordChange: vi.fn(),
  listChanges: vi.fn(),
  userGet: vi.fn(),
  verifyKey: vi.fn(),
  registerEndpoint: vi.fn(),
  removeLeftoverEndpoints: vi.fn(),
  removeEndpoint: vi.fn(),
  writeStripeSecrets: vi.fn(),
  clearStripeSecrets: vi.fn(),
  readStripeApiKey: vi.fn(),
}));

vi.mock('@discava/core-table', async (importActual) => ({
  ...(await importActual<typeof import('@discava/core-table')>()),
  getConnection: mocks.getConnection,
  beginChange: mocks.beginChange,
  completeConnection: mocks.completeConnection,
  completeDisconnect: mocks.completeDisconnect,
  rotateKey: mocks.rotateKey,
  abandonChange: mocks.abandonChange,
  recordChange: mocks.recordChange,
  listChanges: mocks.listChanges,
  createCoreTableService: vi.fn(async () => ({
    entities: { user: { get: mocks.userGet } },
  })),
}));
vi.mock(
  '@discava/common-server-utils/stripe/connect',
  async (importActual) => ({
    ...(await importActual<
      typeof import('@discava/common-server-utils/stripe/connect')
    >()),
    verifyKey: mocks.verifyKey,
    registerEndpoint: mocks.registerEndpoint,
    removeLeftoverEndpoints: mocks.removeLeftoverEndpoints,
    removeEndpoint: mocks.removeEndpoint,
  }),
);
vi.mock('@discava/common-server-utils/stripe/secrets-admin', () => ({
  writeStripeSecrets: mocks.writeStripeSecrets,
  clearStripeSecrets: mocks.clearStripeSecrets,
  readStripeApiKey: mocks.readStripeApiKey,
}));

import { ConnectError } from '@discava/common-server-utils/stripe/connect';
import { ChangeInProgressError, OpenCheckoutError } from '@discava/core-table';

const caller = t.createCallerFactory(
  t.router({
    status: paymentStatus,
    connect: connectPayment,
    disconnect: disconnectPayment,
  }),
);

const callAs = (groups: string[] | null = ['admin']) =>
  caller({
    event: {
      requestContext: {
        authorizer: groups
          ? { claims: { sub: 'admin-1', 'cognito:groups': groups } }
          : { claims: {} },
      },
    } as unknown as APIGatewayProxyEvent,
    context: {} as any,
    info: {} as any,
  });

const KEY = 'sk_test_SECRETSECRETSECRET1234';
const OLD_KEY = 'sk_test_OLDOLDOLDOLDOLD9999';
const URL = 'https://api.example.com/stripe/webhook';
const verified = {
  mode: 'test' as const,
  accountId: 'acct_1',
  accountName: 'Acme',
  keyLast4: '1234',
};
const active = (over: Record<string, unknown> = {}) => ({
  status: 'active',
  mode: 'test',
  accountId: 'acct_1',
  accountName: 'Acme',
  keyLast4: '9999',
  webhookEndpointId: 'we_old',
  webhookUrl: URL,
  revision: 3,
  ...over,
});
const leased = {
  status: 'changing',
  mode: 'test',
  revision: 4,
  previousStatus: 'active',
};

let logged: unknown[][];
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('STRIPE_WEBHOOK_URL', URL);
  vi.stubEnv('STRIPE_ENDPOINT_STAGE', 'dev');
  logged = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args) => {
      logged.push(args);
    });
  }
  mocks.userGet.mockReturnValue({
    go: async () => ({ data: { givenName: 'Carol', familyName: 'Admin' } }),
  });
  mocks.getConnection.mockResolvedValue(undefined);
  mocks.listChanges.mockResolvedValue([]);
  mocks.verifyKey.mockResolvedValue(verified);
  mocks.beginChange.mockResolvedValue(leased);
  mocks.registerEndpoint.mockResolvedValue({
    id: 'we_new',
    secret: 'whsec_NEWSIGNING',
  });
  mocks.removeLeftoverEndpoints.mockResolvedValue(0);
  mocks.removeEndpoint.mockResolvedValue(true);
  mocks.readStripeApiKey.mockResolvedValue(OLD_KEY);
  mocks.completeConnection.mockResolvedValue({});
  mocks.completeDisconnect.mockResolvedValue({});
  mocks.rotateKey.mockResolvedValue({});
  mocks.recordChange.mockResolvedValue(undefined);
  mocks.abandonChange.mockResolvedValue(undefined);
  mocks.writeStripeSecrets.mockResolvedValue(undefined);
  mocks.clearStripeSecrets.mockResolvedValue(undefined);
});

// Everything a caller or a log could see.
const everything = (value: unknown) =>
  JSON.stringify([value, logged, mocks.recordChange.mock.calls]);

const noSecretWrites = () => {
  expect(mocks.writeStripeSecrets).not.toHaveBeenCalled();
  expect(mocks.clearStripeSecrets).not.toHaveBeenCalled();
};

describe('authorisation', () => {
  it.each([[['instructor']], [['student']], [[]], [null]])(
    'refuses %j on every procedure',
    async (groups) => {
      const api = callAs(groups);
      for (const call of [
        () => api.status(),
        () => api.connect({ secretKey: KEY }),
        () => api.disconnect(),
      ]) {
        await expect(call()).rejects.toMatchObject({
          code: groups ? 'FORBIDDEN' : 'UNAUTHORIZED',
        });
      }
      noSecretWrites();
      expect(mocks.verifyKey).not.toHaveBeenCalled();
    },
  );
});

describe('payment.status', () => {
  it('is not-connected before the first save', async () => {
    expect(await callAs().status()).toEqual({
      state: 'not-connected',
      changes: [],
    });
  });

  it('shows an active connection without any secret, with the open-checkout time and address change', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    mocks.getConnection.mockResolvedValue(
      active({
        changedByName: 'Carol Admin',
        changedAt: '2026-01-01T00:00:00.000Z',
        latestCheckoutExpiresAt: future,
        webhookUrl: 'https://old.example.com/stripe/webhook',
      }),
    );
    mocks.listChanges.mockResolvedValue([
      {
        kind: 'connected',
        byName: 'Carol Admin',
        at: 'x',
        mode: 'test',
        keyLast4: '9999',
        changeId: 'c',
        byUserId: 'u',
      },
    ]);
    const status = await callAs().status();
    expect(status).toEqual({
      state: 'active',
      mode: 'test',
      accountName: 'Acme',
      keyLast4: '9999',
      changedByName: 'Carol Admin',
      changedAt: '2026-01-01T00:00:00.000Z',
      openCheckoutsUntil: future,
      addressChanged: true,
      changes: [
        {
          kind: 'connected',
          byName: 'Carol Admin',
          at: 'x',
          mode: 'test',
          keyLast4: '9999',
        },
      ],
    });
    expect(JSON.stringify(status)).not.toMatch(/sk_|whsec_|we_old|acct_1/);
  });

  it('shows a disconnected record with no account', async () => {
    mocks.getConnection.mockResolvedValue({
      status: 'disconnected',
      mode: 'test',
      revision: 5,
    });
    expect(await callAs().status()).toEqual({
      state: 'disconnected',
      changes: [],
    });
  });
});

describe('payment.connect: a first connection', () => {
  it('stores the signing secret then the key, marks it active and records it', async () => {
    const result = await callAs().connect({ secretKey: KEY });

    expect(mocks.verifyKey).toHaveBeenCalledWith(KEY);
    expect(mocks.beginChange).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'test',
        by: { userId: 'admin-1', name: 'Carol Admin' },
      }),
    );
    expect(mocks.removeLeftoverEndpoints).toHaveBeenCalledWith({
      secretKey: KEY,
      url: URL,
      stage: 'dev',
    });
    expect(mocks.registerEndpoint).toHaveBeenCalledWith({
      secretKey: KEY,
      url: URL,
      stage: 'dev',
    });
    expect(mocks.writeStripeSecrets).toHaveBeenCalledWith({
      webhookSecret: 'whsec_NEWSIGNING',
      apiKey: KEY,
    });
    expect(mocks.completeConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: leased,
        facts: { ...verified, webhookEndpointId: 'we_new', webhookUrl: URL },
      }),
    );
    expect(mocks.recordChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'connected',
        keyLast4: '1234',
        mode: 'test',
      }),
    );
    expect(mocks.abandonChange).not.toHaveBeenCalled();
    expect(everything(result)).not.toContain(KEY);
    expect(everything(result)).not.toContain('whsec_');
  });
});

describe('payment.connect: refusals write no secret', () => {
  it.each([
    [
      'a bad key',
      new ConnectError('Stripe rejected this key', 'BAD_REQUEST', 'key'),
      'BAD_REQUEST',
      'key',
    ],
    [
      'a key without permission',
      new ConnectError(
        "This key can't create webhook endpoints",
        'BAD_REQUEST',
        'registration',
      ),
      'BAD_REQUEST',
      'registration',
    ],
  ])('on %s', async (_name, error, code, step) => {
    mocks.verifyKey.mockRejectedValue(error);
    await expect(callAs().connect({ secretKey: KEY })).rejects.toMatchObject({
      code,
      message: error.message,
    });
    noSecretWrites();
    expect(mocks.beginChange).not.toHaveBeenCalled();
    expect(mocks.recordChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'failed', step }),
    );
  });

  it('when registration fails, leaving the earlier record as it was', async () => {
    mocks.registerEndpoint.mockRejectedValue(
      new ConnectError(
        "Couldn't register the confirmation address; nothing was changed",
        'INTERNAL_SERVER_ERROR',
        'registration',
      ),
    );
    await expect(callAs().connect({ secretKey: KEY })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
    noSecretWrites();
    expect(mocks.abandonChange).toHaveBeenCalledWith(
      expect.objectContaining({ connection: leased }),
    );
    expect(mocks.completeConnection).not.toHaveBeenCalled();
  });

  it('when the address is not known', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_URL', '');
    await expect(callAs().connect({ secretKey: KEY })).rejects.toMatchObject({
      message: "The payment confirmation address isn't available",
    });
    noSecretWrites();
    expect(mocks.beginChange).not.toHaveBeenCalled();
  });

  it('refuses a publishable key and malformed input without echoing them', async () => {
    const pk = 'pk_test_PUBLISHABLEPUBLISHABLE';
    mocks.verifyKey.mockRejectedValue(
      new ConnectError(
        "That's a publishable key; paste the secret key",
        'BAD_REQUEST',
        'key',
      ),
    );
    const error = await callAs()
      .connect({ secretKey: pk })
      .catch((e) => e);
    expect(error.message).not.toContain(pk);
    expect(everything(error.message)).not.toContain(pk);
    await expect(
      callAs().connect({ secretKey: 'x'.repeat(600) }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    noSecretWrites();
  });

  it('when the secrets service fails, releasing the lease and removing the new registration', async () => {
    mocks.writeStripeSecrets.mockRejectedValue(
      new Error(`AccessDenied ${KEY}`),
    );
    const error = await callAs()
      .connect({ secretKey: KEY })
      .catch((e) => e);
    expect(error).toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    expect(everything(error.message)).not.toContain(KEY);
    expect(everything(error.cause)).not.toContain(KEY);
    expect(mocks.abandonChange).toHaveBeenCalled();
    expect(mocks.removeEndpoint).toHaveBeenCalledWith({
      secretKey: KEY,
      endpointId: 'we_new',
    });
    expect(mocks.completeConnection).not.toHaveBeenCalled();
    expect(mocks.recordChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'failed', step: 'storage' }),
    );
  });
});

describe('payment.connect: a rotation', () => {
  it('writes one secret, registers nothing and records a replacement', async () => {
    mocks.getConnection.mockResolvedValue(active());
    await callAs().connect({ secretKey: KEY });

    expect(mocks.rotateKey).toHaveBeenCalledWith(
      expect.objectContaining({ connection: active(), keyLast4: '1234' }),
    );
    expect(mocks.writeStripeSecrets).toHaveBeenCalledTimes(1);
    expect(mocks.writeStripeSecrets).toHaveBeenCalledWith({ apiKey: KEY });
    expect(mocks.beginChange).not.toHaveBeenCalled();
    expect(mocks.registerEndpoint).not.toHaveBeenCalled();
    expect(mocks.recordChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'replaced' }),
    );
  });

  it('loses to a concurrent switch on revision, writing no secret', async () => {
    mocks.getConnection.mockResolvedValue(active());
    mocks.rotateKey.mockRejectedValue(new ChangeInProgressError());
    await expect(callAs().connect({ secretKey: KEY })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Another change is in progress; try again in a minute',
    });
    noSecretWrites();
  });

  it('is a switch, not a rotation, when the address changed or the mode did', async () => {
    mocks.getConnection.mockResolvedValue(
      active({ webhookUrl: 'https://old.example.com/x' }),
    );
    await callAs().connect({ secretKey: KEY });
    expect(mocks.rotateKey).not.toHaveBeenCalled();
    expect(mocks.registerEndpoint).toHaveBeenCalled();
    expect(mocks.recordChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'replaced' }),
    );

    vi.clearAllMocks();
    mocks.getConnection.mockResolvedValue(active({ mode: 'live' }));
    mocks.verifyKey.mockResolvedValue(verified);
    mocks.beginChange.mockResolvedValue(leased);
    mocks.registerEndpoint.mockResolvedValue({
      id: 'we_new',
      secret: 'whsec_x',
    });
    mocks.removeLeftoverEndpoints.mockResolvedValue(0);
    mocks.readStripeApiKey.mockResolvedValue(OLD_KEY);
    mocks.userGet.mockReturnValue({ go: async () => ({ data: {} }) });
    mocks.listChanges.mockResolvedValue([]);
    await callAs().connect({ secretKey: KEY });
    expect(mocks.rotateKey).not.toHaveBeenCalled();
    expect(mocks.beginChange).toHaveBeenCalled();
  });
});

describe('payment.connect: a switch', () => {
  beforeEach(() => {
    mocks.getConnection.mockResolvedValue(
      active({ accountId: 'acct_old', webhookEndpointId: 'we_old' }),
    );
  });

  it('removes the old registration with the old key and records a switch', async () => {
    const result = await callAs().connect({ secretKey: KEY });
    expect(mocks.readStripeApiKey).toHaveBeenCalled();
    expect(mocks.removeEndpoint).toHaveBeenCalledWith({
      secretKey: OLD_KEY,
      endpointId: 'we_old',
    });
    expect(mocks.recordChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'switched' }),
    );
    expect(result.warning).toBeUndefined();
    expect(everything(result)).not.toContain(OLD_KEY);
  });

  it('warns, and keeps the change, when the old registration cannot be removed', async () => {
    mocks.removeEndpoint.mockResolvedValue(false);
    const result = await callAs().connect({ secretKey: KEY });
    expect(result.warning).toMatch(/old confirmation address/);
    expect(mocks.completeConnection).toHaveBeenCalled();
    expect(mocks.abandonChange).not.toHaveBeenCalled();
  });

  it('with an open checkout writes nothing and names the end time', async () => {
    mocks.beginChange.mockRejectedValue(
      new OpenCheckoutError('2026-11-19T01:00:00.000Z'),
    );
    await expect(callAs().connect({ secretKey: KEY })).rejects.toMatchObject({
      code: 'CONFLICT',
      message:
        'Checkouts are open until 2026-11-19T01:00:00.000Z; try again after',
    });
    noSecretWrites();
    expect(mocks.registerEndpoint).not.toHaveBeenCalled();
    expect(mocks.recordChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'failed', step: 'open-checkout' }),
    );
  });

  it('gives the second of two saves at once the lease conflict', async () => {
    mocks.beginChange
      .mockResolvedValueOnce(leased)
      .mockRejectedValueOnce(new ChangeInProgressError());
    const results = await Promise.allSettled([
      callAs().connect({ secretKey: KEY }),
      callAs().connect({ secretKey: KEY }),
    ]);
    const lost = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(lost.reason).toMatchObject({ code: 'CONFLICT' });
    expect(mocks.writeStripeSecrets).toHaveBeenCalledTimes(1);
  });

  it('leaves the old secrets untouched when the switch fails before storing', async () => {
    mocks.registerEndpoint.mockRejectedValue(
      new ConnectError(
        "Couldn't register the confirmation address; nothing was changed",
        'INTERNAL_SERVER_ERROR',
        'registration',
      ),
    );
    await expect(callAs().connect({ secretKey: KEY })).rejects.toBeDefined();
    noSecretWrites();
    expect(mocks.removeEndpoint).not.toHaveBeenCalled();
    expect(mocks.abandonChange).toHaveBeenCalled();
  });
});

describe('payment.disconnect', () => {
  it('is refused when nothing is connected', async () => {
    await expect(callAs().disconnect()).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    mocks.getConnection.mockResolvedValue({
      status: 'disconnected',
      mode: 'test',
      revision: 4,
    });
    await expect(callAs().disconnect()).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(mocks.beginChange).not.toHaveBeenCalled();
  });

  it('takes the lease, removes the registration, clears both secrets and records it', async () => {
    mocks.getConnection
      .mockResolvedValueOnce(active())
      .mockResolvedValue({ status: 'disconnected', mode: 'test', revision: 5 });
    const result = await callAs().disconnect();
    expect(mocks.beginChange).toHaveBeenCalled();
    expect(mocks.removeEndpoint).toHaveBeenCalledWith({
      secretKey: OLD_KEY,
      endpointId: 'we_old',
    });
    expect(mocks.clearStripeSecrets).toHaveBeenCalledTimes(1);
    expect(mocks.completeDisconnect).toHaveBeenCalled();
    expect(mocks.recordChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'disconnected', keyLast4: '9999' }),
    );
    expect(result.state).toBe('disconnected');
  });

  it('is a conflict while checkouts are open, clearing nothing', async () => {
    mocks.getConnection.mockResolvedValue(active());
    mocks.beginChange.mockRejectedValue(
      new OpenCheckoutError('2026-11-19T01:00:00.000Z'),
    );
    await expect(callAs().disconnect()).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    noSecretWrites();
  });

  it('warns when the registration could not be removed, and still disconnects', async () => {
    mocks.getConnection.mockResolvedValue(active());
    mocks.removeEndpoint.mockResolvedValue(false);
    const result = await callAs().disconnect();
    expect(result.warning).toMatch(/old confirmation address/);
    expect(mocks.clearStripeSecrets).toHaveBeenCalled();
  });
});

describe('the key never leaves', () => {
  it('is in no response, error, audit row or log line, on success or on any failure', async () => {
    const outcomes: unknown[] = [];
    mocks.getConnection.mockResolvedValue(active({ accountId: 'acct_old' }));
    outcomes.push(await callAs().connect({ secretKey: KEY }));
    mocks.verifyKey.mockRejectedValueOnce(new Error(`rejected ${KEY}`));
    outcomes.push(
      await callAs()
        .connect({ secretKey: KEY })
        .catch((e) => e),
    );
    mocks.registerEndpoint.mockRejectedValueOnce(new Error(`boom ${KEY}`));
    outcomes.push(
      await callAs()
        .connect({ secretKey: KEY })
        .catch((e) => e),
    );
    mocks.completeConnection.mockRejectedValueOnce(new Error(`write ${KEY}`));
    outcomes.push(
      await callAs()
        .connect({ secretKey: KEY })
        .catch((e) => e),
    );
    outcomes.push(await callAs().status());
    for (const outcome of outcomes) {
      const text =
        outcome instanceof Error
          ? `${outcome.message} ${outcome.stack} ${JSON.stringify(outcome.cause ?? '')}`
          : JSON.stringify(outcome);
      expect(text).not.toContain(KEY);
      expect(text).not.toContain('SECRETSECRET');
    }
    expect(JSON.stringify(logged)).not.toContain('SECRETSECRET');
    expect(JSON.stringify(mocks.recordChange.mock.calls)).not.toContain(
      'SECRETSECRET',
    );
  });

  it('writes audit rows for success and failure with at most four key characters', async () => {
    await callAs().connect({ secretKey: KEY });
    mocks.verifyKey.mockRejectedValueOnce(
      new ConnectError('Stripe rejected this key', 'BAD_REQUEST', 'key'),
    );
    await callAs()
      .connect({ secretKey: KEY })
      .catch(() => undefined);
    const rows = mocks.recordChange.mock.calls.map(([, row]) => row);
    expect(rows.map((row) => row.kind)).toEqual(['connected', 'failed']);
    for (const row of rows) {
      expect(row.keyLast4 === undefined || row.keyLast4.length <= 4).toBe(true);
    }
  });
});
