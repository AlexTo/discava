/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  buyCourse,
  expectAfterEarningsReload,
  instructorOf,
  openEarnings,
  PRICE_MINOR,
  publishPricedCourse,
  refundPayment,
  replayEvent,
  reportRow,
  showOrders,
} from '../helpers/earnings.js';
import { routerQueues, waitForQueuesToDrain } from '../helpers/router.js';
import { expect, test } from '../helpers/table-invariants.js';

// An order is recorded in the ledger once however often its paid and refund
// events arrive, and at the same moment: one sale entry, refund entries that
// sum to what was refunded, and nothing left in the feature's failure queue.

const REPLAYS = 6;
const PARTIAL = 500;

test('replayed paid and refund events record each sale and refund once', async ({
  browser,
}) => {
  const { page, title } = await publishPricedCourse(browser);
  const session = await buyCourse(browser, title, 'Rae');

  // The paid event again, several times at once.
  await replayEvent(session, REPLAYS);
  await openEarnings(page);
  await expectAfterEarningsReload(page, async () => {
    expect((await reportRow(page, title)).orders).toBe(1);
  });
  const orders = await showOrders(page, title);
  const orderId = (
    await orders.locator('tbody > tr').first().locator('td').nth(1).innerText()
  ).trim();
  const { coreTable, instructorId } = await instructorOf(orderId);

  // A partial refund, then the rest, each delivered several times at once.
  await refundPayment(session, PARTIAL);
  await replayEvent(session, REPLAYS);
  await refundPayment(session);
  await replayEvent(session, REPLAYS);
  await waitForQueuesToDrain();

  const { data } = await coreTable.entities.earningEntry.query
    .primary({ instructorId })
    .go({ pages: 'all' });
  const entries = data.filter((entry) => entry.entryId.includes(orderId));
  const sales = entries.filter((entry) => entry.kind === 'sale');
  const refunds = entries.filter((entry) => entry.kind === 'refund');
  expect(sales).toHaveLength(1);
  expect(refunds.length).toBeGreaterThan(0);
  expect(
    refunds.reduce((sum, entry) => sum + entry.refundMinor, 0),
    'refund entries sum to the refunded total',
  ).toBe(PRICE_MINOR);
  expect(
    entries.reduce((sum, entry) => sum + entry.netMinor, 0),
    'the order nets to zero',
  ).toBe(0);

  const failures = (await routerQueues()).find(
    (feature) => feature.name === 'earnings-recording',
  );
  expect(failures?.failures.count).toBe(0);
});
