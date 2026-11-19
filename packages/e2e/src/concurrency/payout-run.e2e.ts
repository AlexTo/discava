/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import {
  createCoreTableService,
  openEntries,
  recordSale,
  saveAccountStatus,
} from '@discava/core-table';
import {
  apiUser,
  connectLocalStripe,
  createPublishedCourseViaApi,
} from '../helpers/api.js';
import { SERVICES } from '../helpers/portals.js';
import { expect, test } from '../helpers/table-invariants.js';
import { uniqueName } from '../helpers/users.js';

// Several payout runs at the same moment pay an instructor's released
// earnings once: one sent payout, one transfer for their sum, every entry in
// exactly one payout. The earnings are more than a transaction's 99 entries,
// so the payout is collected in batches that the runs race for.

const SALES = 120;
const RUNS = 4;
const API_KEY = 'sk_test_local';
const RUNNER = SERVICES.eventRunner.replace(/\/$/, '');

const stripe = (path: string, init: RequestInit = {}) =>
  fetch(`${RUNNER}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${API_KEY}`, ...init.headers },
  });

const runPayouts = (body: object = {}) =>
  fetch(`${RUNNER}/payout-run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('payout runs at the same moment pay released earnings once', async () => {
  await connectLocalStripe();
  const coreTable = await createCoreTableService();
  const instructor = await apiUser('Ines', ['instructor']);
  const instructorId = instructor.sub;
  const { courseId } = await createPublishedCourseViaApi(
    instructor,
    uniqueName('Payout race'),
  );

  // The instructor has an active payout account on the stand-in.
  const created = await stripe('/v1/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ type: 'express' }),
  });
  const { id: connectedAccountId } = (await created.json()) as { id: string };
  await stripe(`/stripe/test/connected-accounts/${connectedAccountId}/status`, {
    method: 'POST',
    body: JSON.stringify({ status: 'complete' }),
  });
  await saveAccountStatus({
    coreTable,
    instructorId,
    accountId: 'acct_local',
    mode: 'test',
    connectedAccountId,
    status: 'active',
  });

  // More released earnings than one transaction holds. Each sale is recorded
  // with no hold and then its order is stored, so the earnings match their
  // orders; the router's own recording of those orders finds the sale already
  // recorded and changes nothing.
  const paidAt = new Date(Date.now() - 60_000).toISOString();
  const orderIds = Array.from({ length: SALES }, () => randomUUID());
  for (let start = 0; start < SALES; start += 20) {
    await Promise.all(
      orderIds.slice(start, start + 20).map(async (orderId) => {
        const order = {
          orderId,
          courseId,
          accountId: 'acct_local',
          mode: 'test' as const,
          currency: 'usd',
          listAmount: 1000,
          amount: 1000,
          paidAt,
        };
        await recordSale({
          coreTable,
          order,
          instructorIds: [instructorId],
          feeBasisPoints: 2000,
          holdDays: 0,
        });
        await coreTable.entities.order
          .put({
            ...order,
            userId: randomUUID(),
            courseTitle: 'Payout race',
            status: 'paid',
            expiresAt: paidAt,
          })
          .go();
      }),
    );
  }
  const seeded = await openEntries({ coreTable, instructorId });
  expect(seeded).toHaveLength(SALES);
  const total = seeded.reduce((sum, entry) => sum + entry.netMinor, 0);

  await Promise.allSettled(Array.from({ length: RUNS }, () => runPayouts()));
  // One more run that takes over whatever the others left behind.
  await runPayouts({ graceSeconds: 0 });

  const { data: payouts } = await coreTable.entities.payout.query
    .primary({ instructorId })
    .go({ pages: 'all' });
  expect(
    payouts.map((p) => p.status),
    'exactly one sent payout, and no collecting or releasing one left',
  ).toEqual(['sent']);
  const [payout] = payouts;
  expect(payout).toMatchObject({ amountMinor: total, entryCount: SALES });

  const { transfers } = (await (
    await stripe('/stripe/test/transfers')
  ).json()) as {
    transfers: {
      id: string;
      amount: number;
      destination: string;
      transfer_group?: string;
    }[];
  };
  const sent = transfers.filter((t) => t.destination === connectedAccountId);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    amount: total,
    transfer_group: payout?.payoutId,
  });
  expect(payout?.transferId).toBe(sent[0]?.id);

  // Every entry is in exactly this payout and none is left open.
  expect(await openEntries({ coreTable, instructorId })).toEqual([]);
  const { data: entries } = await coreTable.entities.earningEntry.query
    .bySettlement({ settlement: `payout#${payout?.payoutId}` })
    .go({ pages: 'all' });
  expect(entries).toHaveLength(SALES);
  expect(new Set(entries.map((e) => e.entryId)).size).toBe(SALES);
});
