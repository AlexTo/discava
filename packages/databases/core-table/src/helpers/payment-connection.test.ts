/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  abandonChange,
  beginChange,
  ChangeInProgressError,
  completeConnection,
  completeDisconnect,
  getConnection,
  listChanges,
  OpenCheckoutError,
  recordChange,
  rotateKey,
} from './payment-connection.js';
import { createFakeCoreTable } from './payment-fake.test.js';

const NOW = '2026-11-19T00:00:00.000Z';
const by = { userId: 'admin-1', name: 'Carol' };
const facts = {
  mode: 'test' as const,
  accountId: 'acct_1',
  accountName: 'Account',
  keyLast4: 'wxyz',
  webhookEndpointId: 'we_1',
  webhookUrl: 'https://example.com/stripe/webhook',
};
const active = {
  status: 'active',
  ...facts,
  revision: 3,
};

const begin = (fake: ReturnType<typeof createFakeCoreTable>, now = NOW) =>
  beginChange({ coreTable: fake.coreTable, now, mode: 'test', by });

describe('beginChange', () => {
  it('creates the record for a first connection, leased', async () => {
    const fake = createFakeCoreTable();
    const record = await begin(fake);
    expect(record).toMatchObject({
      status: 'changing',
      revision: 1,
      leaseUntil: '2026-11-19T00:02:00.000Z',
      previousStatus: 'disconnected',
    });
    expect(await getConnection(fake.coreTable)).toMatchObject({
      status: 'changing',
    });
  });

  it('takes the lease from an active record with no open checkout', async () => {
    const fake = createFakeCoreTable();
    fake.put('paymentConnection', {
      ...active,
      latestCheckoutExpiresAt: '2026-11-18T23:00:00.000Z',
    });
    const record = await begin(fake);
    expect(record).toMatchObject({
      status: 'changing',
      previousStatus: 'active',
      revision: 4,
    });
  });

  it('refuses a switch while a checkout may be open, naming the time', async () => {
    const fake = createFakeCoreTable();
    fake.put('paymentConnection', {
      ...active,
      latestCheckoutExpiresAt: '2026-11-19T00:30:00.000Z',
    });
    const error = await begin(fake).catch((e) => e);
    expect(error).toBeInstanceOf(OpenCheckoutError);
    expect(error.until).toBe('2026-11-19T00:30:00.000Z');
    expect((await getConnection(fake.coreTable))?.status).toBe('active');
  });

  it('lets a disconnected record be connected again', async () => {
    const fake = createFakeCoreTable();
    fake.put('paymentConnection', {
      status: 'disconnected',
      mode: 'test',
      revision: 5,
      latestCheckoutExpiresAt: '2026-11-19T00:30:00.000Z',
    });
    expect(await begin(fake)).toMatchObject({
      status: 'changing',
      previousStatus: 'disconnected',
    });
  });

  it('gives the lease to one of two concurrent calls', async () => {
    const fake = createFakeCoreTable();
    fake.put('paymentConnection', { ...active });
    const results = await Promise.allSettled([begin(fake), begin(fake)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ChangeInProgressError);
  });

  it('gives the first connection to one of two concurrent calls', async () => {
    const fake = createFakeCoreTable();
    const results = await Promise.allSettled([begin(fake), begin(fake)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('is blocked by a live lease and takes over an expired one, keeping the origin', async () => {
    const fake = createFakeCoreTable();
    fake.put('paymentConnection', {
      status: 'changing',
      mode: 'test',
      previousStatus: 'active',
      leaseUntil: '2026-11-19T00:01:00.000Z',
      revision: 2,
    });
    await expect(
      begin(fake, '2026-11-19T00:00:30.000Z'),
    ).rejects.toBeInstanceOf(ChangeInProgressError);
    const taken = await begin(fake, '2026-11-19T00:01:01.000Z');
    expect(taken).toMatchObject({
      status: 'changing',
      previousStatus: 'active',
      leaseUntil: '2026-11-19T00:03:01.000Z',
      revision: 3,
    });
  });

  it('loses to a checkout that raises the expiry after the read', async () => {
    const fake = createFakeCoreTable();
    fake.put('paymentConnection', { ...active });
    fake.hooks.beforeTransaction = () =>
      fake.put('paymentConnection', {
        ...active,
        latestCheckoutExpiresAt: '2026-11-19T01:00:00.000Z',
      });
    await expect(begin(fake)).rejects.toBeInstanceOf(OpenCheckoutError);
    expect((await getConnection(fake.coreTable))?.status).toBe('active');
  });
});

describe('completing and abandoning a change', () => {
  it('writes the facts, activates and clears the lease', async () => {
    const fake = createFakeCoreTable();
    const leased = await begin(fake);
    const done = await completeConnection({
      coreTable: fake.coreTable,
      connection: leased,
      facts,
      by,
      now: NOW,
    });
    expect(done).toMatchObject({
      status: 'active',
      ...facts,
      revision: 2,
      changedByName: 'Carol',
    });
    expect(done).not.toHaveProperty('leaseUntil');
    expect(done).not.toHaveProperty('previousStatus');
  });

  it('refuses to complete a lease that was taken over', async () => {
    const fake = createFakeCoreTable();
    const leased = await begin(fake);
    await begin(fake, '2026-11-19T00:05:00.000Z');
    await expect(
      completeConnection({
        coreTable: fake.coreTable,
        connection: leased,
        facts,
        by,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ChangeInProgressError);
  });

  it('abandonChange restores the previous status and ends the lease', async () => {
    const fake = createFakeCoreTable();
    fake.put('paymentConnection', { ...active });
    const leased = await begin(fake);
    await abandonChange({ coreTable: fake.coreTable, connection: leased });
    const record = await getConnection(fake.coreTable);
    expect(record).toMatchObject({ status: 'active', accountId: 'acct_1' });
    expect(record).not.toHaveProperty('leaseUntil');
  });

  it('abandonChange leaves a record that has moved on alone', async () => {
    const fake = createFakeCoreTable();
    fake.put('paymentConnection', { ...active });
    const leased = await begin(fake);
    await begin(fake, '2026-11-19T00:05:00.000Z');
    await abandonChange({ coreTable: fake.coreTable, connection: leased });
    expect((await getConnection(fake.coreTable))?.status).toBe('changing');
  });

  it('a first connection that fails goes back to disconnected', async () => {
    const fake = createFakeCoreTable();
    const leased = await begin(fake);
    await abandonChange({ coreTable: fake.coreTable, connection: leased });
    expect((await getConnection(fake.coreTable))?.status).toBe('disconnected');
  });

  it('disconnecting clears the account facts and keeps the checkout window', async () => {
    const fake = createFakeCoreTable();
    fake.put('paymentConnection', {
      ...active,
      latestCheckoutExpiresAt: '2026-11-18T00:00:00.000Z',
    });
    const leased = await begin(fake);
    const done = await completeDisconnect({
      coreTable: fake.coreTable,
      connection: leased,
      by,
      now: NOW,
    });
    expect(done).toMatchObject({
      status: 'disconnected',
      latestCheckoutExpiresAt: '2026-11-18T00:00:00.000Z',
    });
    for (const field of [
      'accountId',
      'keyLast4',
      'webhookEndpointId',
      'leaseUntil',
    ]) {
      expect(done).not.toHaveProperty(field);
    }
  });
});

describe('rotateKey', () => {
  it('updates the last four characters and the revision', async () => {
    const fake = createFakeCoreTable();
    fake.put('paymentConnection', { ...active });
    const done = await rotateKey({
      coreTable: fake.coreTable,
      connection: { revision: 3 },
      keyLast4: 'abcdefgh',
      by,
      now: NOW,
    });
    expect(done).toMatchObject({
      keyLast4: 'efgh',
      revision: 4,
      changedBy: 'admin-1',
      changedAt: NOW,
    });
  });

  it('loses to a concurrent switch on revision', async () => {
    const fake = createFakeCoreTable();
    fake.put('paymentConnection', { ...active });
    const read = await getConnection(fake.coreTable);
    await begin(fake);
    await expect(
      rotateKey({
        coreTable: fake.coreTable,
        connection: read!,
        keyLast4: 'abcd',
        by,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ChangeInProgressError);
    expect((await getConnection(fake.coreTable))?.keyLast4).toBe('wxyz');
  });
});

describe('the audit rows', () => {
  it('stores at most four key characters', async () => {
    const fake = createFakeCoreTable();
    await recordChange(fake.coreTable, {
      kind: 'connected',
      byUserId: 'admin-1',
      byName: 'Carol',
      at: NOW,
      mode: 'test',
      keyLast4: 'sk_test_0123456789',
    });
    const [row] = fake.rows('paymentChange');
    expect(row?.keyLast4).toBe('6789');
    expect(JSON.stringify(row)).not.toContain('sk_test');
  });

  it('lists newest first', async () => {
    const fake = createFakeCoreTable();
    for (const at of ['a', 'b', 'c']) {
      await recordChange(fake.coreTable, {
        kind: 'failed',
        byUserId: 'u',
        byName: 'n',
        at,
        step: 'key',
      });
      await new Promise((r) => setTimeout(r, 2));
    }
    const rows = await listChanges(fake.coreTable);
    expect(rows.map((r) => r.at)).toEqual(['c', 'b', 'a']);
  });
});
