/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Locator } from '@playwright/test';
import {
  buyCourse,
  expectAfterEarningsReload,
  expectIdentity,
  openEarnings,
  PRICE_MINOR,
  parseMoney,
  publishPricedCourse,
  releaseEarnings,
  reportRow,
  showOrders,
  stripe,
  triggerPayoutRun,
} from '../helpers/earnings.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { refundSession } from '../helpers/stripe-stand-in.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn } from '../helpers/users.js';

// A new instructor has earned nothing: the Earnings page, reached from the
// navigation, shows each section without inventing figures. Purchases, refunds
// and payouts are covered by the scenarios below.
test('a new instructor finds the Earnings page with nothing earned', async ({
  page,
}) => {
  await test.step('it opens from the navigation', async () => {
    await page.goto(`${PORTALS.instructor}/`);
    await signIn(page, newUser('Esme', ['instructor']));
    await page.getByRole('link', { name: 'Earnings' }).first().click();
    await page.waitForURL(/\/earnings$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Earnings' }),
    ).toBeVisible();
  });

  await test.step('the report, balance and payouts show their empty states', async () => {
    await expect(page.getByText('No sales in this period')).toBeVisible();
    await expect(page.getByText('No payouts yet.')).toBeVisible();
    await expect(page.getByText('Payout account')).toBeVisible();
    await screenshot(page, 'earnings page with nothing earned', {
      fullPage: true,
    });
  });

  await test.step('a custom range can be chosen', async () => {
    await page.getByRole('button', { name: 'Custom range' }).click();
    await expect(page.getByLabel('From', { exact: true })).toBeVisible();
    await expect(page.getByLabel('To', { exact: true })).toBeVisible();
    await expect(page.getByText('No sales in this period')).toBeVisible();
    await screenshot(page, 'custom range picker');
  });
});

// The scenarios below read what the stream feature recorded from real
// purchases and refunds on the local Stripe stand-in. No coupon purchase:
// checkout has no coupon to apply yet, so the discount column stays zero.

/** The lines of an open orders table: reference, type and net. */
const lines = async (orders: Locator) => {
  const rows = await orders.locator('tbody > tr').all();
  return Promise.all(
    rows.map(async (row) => {
      const cells = (await row.locator('td').allInnerTexts()).map((t) =>
        t.trim(),
      );
      return {
        reference: cells[1] ?? '',
        type: cells[2] ?? '',
        net: parseMoney(cells[7] ?? ''),
      };
    }),
  );
};

test('the Earnings page follows sales and refunds, and shows them to their instructor only', async ({
  browser,
}) => {
  const { page, title } = await publishPricedCourse(browser);
  const first = await buyCourse(browser, title, 'Sam');
  await buyCourse(browser, title, 'Sue');

  await test.step('both orders show with the fee and net', async () => {
    await openEarnings(page);
    await expectAfterEarningsReload(page, async () => {
      const row = await reportRow(page, title);
      expect(row.orders).toBe(2);
    });
    const row = await reportRow(page, title);
    expect(row).toMatchObject({
      gross: 2 * PRICE_MINOR,
      discounts: 0,
      refunds: 0,
    });
    expect(row.fee).toBeGreaterThan(0);
    expectIdentity(row);
    await screenshot(page, 'earnings after two sales');
  });

  await test.step('the total row equals the sum of the course rows', async () => {
    const course = await reportRow(page, title);
    const total = await reportRow(page, 'Total');
    expect(total).toEqual(course);
    expectIdentity(total);
  });

  await test.step('the lines add up to the row and show no buyer', async () => {
    const orders = await showOrders(page, title);
    const found = await lines(orders);
    expect(found).toHaveLength(2);
    expect(found.every((line) => line.type === 'Sale')).toBe(true);
    const row = await reportRow(page, title);
    expect(found.reduce((sum, line) => sum + line.net, 0)).toBe(row.net);
    await expect(orders).not.toContainText(/Sam|Sue|@example\.com/);
    await screenshot(page, 'earnings order lines');
  });

  await test.step('a partial refund adds a refund line and changes Refunds and Net', async () => {
    const before = await reportRow(page, title);
    await refundSession(first, 500);
    await expectAfterEarningsReload(page, async () => {
      expect((await reportRow(page, title)).refunds).toBe(500);
    });
    const row = await reportRow(page, title);
    expect(row.net).toBeLessThan(before.net);
    expectIdentity(row);
    expectIdentity(await reportRow(page, 'Total'));
    const orders = await showOrders(page, title);
    const found = await lines(orders);
    expect(found.filter((line) => line.type === 'Refund')).toHaveLength(1);
    expect(found.reduce((sum, line) => sum + line.net, 0)).toBe(row.net);
    await screenshot(page, 'earnings after a partial refund');
  });

  await test.step('refunding the rest brings the order to zero', async () => {
    await refundSession(first);
    await expectAfterEarningsReload(page, async () => {
      expect((await reportRow(page, title)).refunds).toBe(PRICE_MINOR);
    });
    const row = await reportRow(page, title);
    expectIdentity(row);
    const found = await lines(await showOrders(page, title));
    const byOrder = new Map<string, number>();
    for (const line of found) {
      byOrder.set(
        line.reference,
        (byOrder.get(line.reference) ?? 0) + line.net,
      );
    }
    // One order is netted to zero, the other still earns.
    expect([...byOrder.values()].filter((net) => net === 0)).toHaveLength(1);
    expect(found.reduce((sum, line) => sum + line.net, 0)).toBe(row.net);
    await screenshot(page, 'earnings after a full refund');
  });

  await test.step('another instructor sees none of it', async () => {
    const other = await browser.newPage();
    await other.goto(`${PORTALS.instructor}/earnings`);
    await signIn(other, newUser('Omar', ['instructor']));
    await expect(other.getByText('No sales in this period')).toBeVisible();
    await expect(other.getByText(title)).toHaveCount(0);
    await screenshot(other, 'earnings of an instructor with no sales');
  });
});

test('payout account, payout run, refund after sending and a failed transfer', async ({
  browser,
}) => {
  const { page, title } = await publishPricedCourse(browser);
  const first = await buyCourse(browser, title, 'Sam');
  let orderId = '';

  await test.step('the instructor sets up payouts and the account is Active', async () => {
    await openEarnings(page);
    await expect(page.getByText('Not set up')).toBeVisible();
    await screenshot(page, 'payouts not set up');
    await page.getByRole('button', { name: 'Set up payouts' }).click();
    await page.waitForURL(/\/stripe\/connect\/onboard\//);
    await page.getByRole('button', { name: 'Complete' }).click();
    await page.waitForURL(/\/earnings/);
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    await screenshot(page, 'payouts active');
  });

  await test.step('earnings on hold become payable once released', async () => {
    await expectAfterEarningsReload(page, async () => {
      expect((await reportRow(page, title)).orders).toBe(1);
    });
    const orders = await showOrders(page, title);
    orderId = (await lines(orders))[0]?.reference ?? '';
    expect(orderId).not.toBe('');
    await releaseEarnings(orderId);
  });

  await test.step('the run sends a payout, and a second run changes nothing', async () => {
    await triggerPayoutRun();
    await page.reload();
    const payouts = page.getByRole('table', { name: 'Payouts' });
    await expect(payouts.getByText('Sent')).toHaveCount(1);
    await screenshot(page, 'payout sent');
    await triggerPayoutRun();
    await page.reload();
    await expect(payouts.getByText('Sent')).toHaveCount(1);
    await expect(payouts.locator('tbody > tr')).toHaveCount(1);
  });

  await test.step('a refund after sending shows a negative balance', async () => {
    await refundSession(first, 500);
    await expectAfterEarningsReload(page, async () => {
      await expect(
        page.getByText(/deducted from your next payout/),
      ).toBeVisible();
    });
    await screenshot(page, 'negative balance after refund');
  });

  await test.step('a failing transfer shows Failed with its reason', async () => {
    await buyCourse(browser, title, 'Sue');
    await expectAfterEarningsReload(page, async () => {
      expect((await reportRow(page, title)).orders).toBe(2);
    });
    await releaseEarnings(orderId);
    const next = await stripe('/stripe/test/transfers/fail-next', {
      method: 'POST',
      body: JSON.stringify({ mode: 'rejected' }),
    });
    expect(next.status).toBe(200);
    await triggerPayoutRun();
    await page.reload();
    const payouts = page.getByRole('table', { name: 'Payouts' });
    await expect(payouts.getByText(/Failed: /)).toBeVisible();
    await screenshot(page, 'payout failed');
  });
});
