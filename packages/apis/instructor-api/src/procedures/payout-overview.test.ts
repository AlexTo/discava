/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeCoreTable } from '../../../../databases/core-table/src/helpers/payment-fake.test.js';
import { t } from '../init.js';
import { overview } from './payout.js';

// The procedure plugin keeps the first table it is given, so it gets one that
// always reads through to the current test's fake.
const { state } = vi.hoisted(() => {
  const state = { current: undefined as unknown };
  return {
    state: {
      ...state,
      coreTable: new Proxy(
        {},
        { get: (_t, name) => Reflect.get(state.current as object, name) },
      ),
      set: (value: unknown) => {
        state.current = value;
      },
    },
  };
});

vi.mock('@discava/core-table', async (importActual) => ({
  ...(await importActual<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => state.coreTable),
}));

const router = t.router({ overview });
const callAs = (sub = 'ins-a') =>
  callerFor(router, { sub, groups: ['instructor'] });

const NOW = new Date('2026-12-10T00:00:00.000Z');
const PAST = '2026-12-01T00:00:00.000Z';
const SOON = '2026-12-12T00:00:00.000Z';
const LATER = '2026-12-20T00:00:00.000Z';

let n = 0;
const entry = (over: Record<string, unknown> = {}) => {
  n++;
  return {
    instructorId: 'ins-a',
    courseId: 'c1',
    orderId: `o${n}`,
    accountId: 'acct_1',
    mode: 'test',
    entryId: `sale-o${n}`,
    kind: 'sale',
    currency: 'USD',
    netMinor: 800,
    occurredAt: PAST,
    releaseAt: PAST,
    settlement: 'open#ins-a',
    ...over,
  };
};

const payout = (over: Record<string, unknown> = {}) => ({
  instructorId: 'ins-a',
  payoutId: 'p1',
  accountId: 'acct_1',
  mode: 'test',
  currency: 'USD',
  status: 'sent',
  amountMinor: 2400,
  entryCount: 3,
  attemptedAt: PAST,
  connectedAccountId: 'acct_conn',
  createdAt: PAST,
  ...over,
});

describe('payout.overview', () => {
  let fake: ReturnType<typeof createFakeCoreTable>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    fake = createFakeCoreTable();
    state.set(fake.coreTable);
    fake.put('paymentConnection', {
      status: 'active',
      mode: 'test',
      accountId: 'acct_1',
      revision: 1,
    });
  });
  afterEach(() => vi.useRealTimers());

  const account = (status: string, instructorId = 'ins-a') =>
    fake.put('payoutAccount', {
      instructorId,
      accountId: 'acct_1',
      mode: 'test',
      connectedAccountId: 'acct_conn',
      status,
    });

  it('sorts open entries into on hold, ready and the next release with an active account', async () => {
    account('active');
    fake.put('earningEntry', entry());
    fake.put('earningEntry', entry({ netMinor: 200 }));
    fake.put('earningEntry', entry({ releaseAt: LATER, netMinor: 500 }));
    fake.put('earningEntry', entry({ releaseAt: SOON, netMinor: 300 }));

    const { currencies } = await callAs().overview();

    expect(currencies).toEqual([
      {
        currency: 'USD',
        onHoldMinor: 800,
        waitingMinor: 0,
        readyMinor: 1000,
        heldMinor: 0,
        nextReleaseAt: SOON,
      },
    ]);
  });

  it.each([
    ['no account', undefined],
    ['an account still being set up', 'in_progress'],
    ['a restricted account', 'restricted'],
  ])('shows released entries as waiting with %s', async (_n, status) => {
    if (status) account(status);
    fake.put('earningEntry', entry());

    const [usd] = (await callAs().overview()).currencies;

    expect(usd).toMatchObject({ waitingMinor: 800, readyMinor: 0 });
  });

  it('returns a negative open total negative, never hidden', async () => {
    account('active');
    fake.put('earningEntry', entry({ netMinor: 300 }));
    fake.put(
      'earningEntry',
      entry({ kind: 'refund', entryId: 'refund-x-1', netMinor: -900 }),
    );

    const [usd] = (await callAs().overview()).currencies;

    expect(usd?.readyMinor).toBe(-600);
  });

  it('keeps currencies apart', async () => {
    account('active');
    fake.put('earningEntry', entry());
    fake.put('earningEntry', entry({ currency: 'EUR', netMinor: 100 }));

    const { currencies } = await callAs().overview();

    expect(currencies.map((c) => [c.currency, c.readyMinor]).sort()).toEqual([
      ['EUR', 100],
      ['USD', 800],
    ]);
  });

  it('holds entries of a former payment account and leaves the other buckets alone', async () => {
    account('active');
    fake.put('earningEntry', entry());
    fake.put('earningEntry', entry({ accountId: 'acct_old', netMinor: 400 }));
    fake.put('earningEntry', entry({ mode: 'live', netMinor: 100 }));

    const [usd] = (await callAs().overview()).currencies;

    expect(usd).toMatchObject({
      readyMinor: 800,
      heldMinor: 500,
      onHoldMinor: 0,
    });
  });

  it('holds every open entry when no connection is active', async () => {
    fake.put('paymentConnection', {
      status: 'disconnected',
      mode: 'test',
      revision: 2,
    });
    fake.put('earningEntry', entry());
    fake.put('earningEntry', entry({ releaseAt: LATER }));

    const [usd] = (await callAs().overview()).currencies;

    expect(usd).toMatchObject({
      heldMinor: 1600,
      readyMinor: 0,
      waitingMinor: 0,
      onHoldMinor: 0,
    });
    expect(usd?.nextReleaseAt).toBeUndefined();
  });

  it('lists payouts newest first, with failure reasons', async () => {
    fake.put(
      'payout',
      payout({ payoutId: 'p1', createdAt: '2026-11-01T00:00:00.000Z' }),
    );
    fake.put(
      'payout',
      payout({
        payoutId: 'p2',
        createdAt: '2026-11-08T00:00:00.000Z',
        status: 'failed',
        failureReason: 'No funds',
        settledAt: '2026-11-08T00:01:00.000Z',
      }),
    );

    const { payouts } = await callAs().overview();

    expect(payouts.map((p) => p.payoutId)).toEqual(['p2', 'p1']);
    expect(payouts[0]).toMatchObject({
      status: 'failed',
      failureReason: 'No funds',
      amountMinor: 2400,
    });
  });

  it('lists collecting as pending, releasing with a reason as failed, and leaves out releasing without one', async () => {
    fake.put(
      'payout',
      payout({
        payoutId: 'a',
        status: 'collecting',
        createdAt: '2026-11-01T00:00:00.000Z',
      }),
    );
    fake.put(
      'payout',
      payout({
        payoutId: 'b',
        status: 'pending',
        createdAt: '2026-11-02T00:00:00.000Z',
      }),
    );
    fake.put(
      'payout',
      payout({
        payoutId: 'c',
        status: 'releasing',
        failureReason: 'Refused',
        createdAt: '2026-11-03T00:00:00.000Z',
      }),
    );
    fake.put(
      'payout',
      payout({
        payoutId: 'd',
        status: 'releasing',
        createdAt: '2026-11-04T00:00:00.000Z',
      }),
    );

    const { payouts } = await callAs().overview();

    expect(payouts.map((p) => [p.payoutId, p.status])).toEqual([
      ['c', 'failed'],
      ['b', 'pending'],
      ['a', 'pending'],
    ]);
  });

  it("never returns another instructor's entries or payouts", async () => {
    account('active');
    fake.put(
      'earningEntry',
      entry({
        instructorId: 'ins-b',
        settlement: 'open#ins-b',
        netMinor: 9999,
      }),
    );
    fake.put('payout', payout({ instructorId: 'ins-b' }));

    expect(await callAs().overview()).toEqual({ currencies: [], payouts: [] });
  });
});
