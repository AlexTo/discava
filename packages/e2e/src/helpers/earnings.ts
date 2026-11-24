/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createCoreTableService, openEntries } from '@discava/core-table';
import type { Browser, Locator, Page } from '@playwright/test';
import { connectLocalStripe } from './api.js';
import {
  addLesson,
  addModule,
  addTextItem,
  createCourse,
  publishCourse,
} from './instructor-portal.js';
import { PORTALS, SERVICES } from './portals.js';
import { openCourse } from './student-portal.js';
import { expect } from './table-invariants.js';
import { newUser, signIn, uniqueName } from './users.js';

// Steps for the instructor's Earnings page: a priced course, students who buy
// it through the checkout flow and the local Stripe stand-in, refunds and the
// payout run, all on the stage's shared stand-in (never switching or
// disconnecting its payment connection).

export const PRICE_MINOR = 1999;
const API_KEY = 'sk_test_local';
const RUNNER = SERVICES.eventRunner.replace(/\/$/, '');

/** A call to the stand-in as the platform account. */
export const stripe = (path: string, init: RequestInit = {}) =>
  fetch(`${RUNNER}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${API_KEY}`, ...init.headers },
  });

/** The instructor, signed in on `page`, with a published course priced at 19.99. */
export const publishPricedCourse = async (browser: Browser) => {
  await connectLocalStripe();
  const title = uniqueName('E2E earnings course');
  const page = await browser.newPage();
  await page.goto(`${PORTALS.instructor}/my-courses`);
  await signIn(page, newUser('Erin', ['instructor']));
  await createCourse(page, {
    title,
    summary: 'A course bought by the earnings tests.',
  });
  const courseId = /\/my-courses\/([0-9a-f-]+)$/.exec(page.url())?.[1] ?? '';
  await page.getByLabel('Price', { exact: true }).fill('19.99');
  await page.getByRole('button', { name: 'Save price' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await addModule(page, 'Module one');
  await addLesson(page, 'Lesson one');
  await addTextItem(page, { title: 'Reading one', body: 'Paid.' });
  await publishCourse(page);
  return { page, title, courseId };
};

/**
 * A fresh student buys the course on the stand-in's hosted page. Returns the
 * checkout session, which the stand-in's refund controls are keyed by.
 */
export const buyCourse = async (
  browser: Browser,
  title: string,
  givenName: string,
) => {
  const student = await browser.newPage();
  await openCourse(student, title);
  await student.getByRole('button', { name: 'Sign in to buy' }).click();
  await student
    .getByRole('dialog', { name: 'Sign in to buy' })
    .getByRole('link', { name: 'Continue to sign in' })
    .click();
  await signIn(student, newUser(givenName, ['student']));
  await student.getByRole('button', { name: 'Buy now' }).click();
  await student.waitForURL(/\/stripe\/pay\//);
  const sessionId = /\/stripe\/pay\/([^/?#]+)/.exec(student.url())?.[1] ?? '';
  await student.getByRole('button', { name: 'Pay', exact: true }).click();
  await student.waitForURL(/checkout=success/);
  await student.close();
  return sessionId;
};

/** Runs the payout run once, as the daily schedule does. */
export const triggerPayoutRun = async (body: object = {}) => {
  const response = await fetch(`${RUNNER}/payout-run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    sent?: number;
    failed?: number;
    recovered?: number;
  };
};

/** An amount as the Earnings page shows it ("$19.99", "-$5.00"), in minor units. */
export const parseMoney = (text: string) => {
  const digits = text.replace(/[^\d.]/g, '');
  const minor = Math.round(Number.parseFloat(digits || '0') * 100);
  return /-|\(/.test(text) ? -minor : minor;
};

export const openEarnings = async (page: Page) => {
  await page.goto(`${PORTALS.instructor}/earnings`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Earnings' }),
  ).toBeVisible();
};

/** The figures of a report row ("Total" or a course's title), in minor units. */
export const reportRow = async (page: Page, rowName: string | RegExp) => {
  const table = page.getByRole('table', { name: 'Earnings in USD' });
  const row =
    rowName === 'Total'
      ? table.locator('tfoot tr')
      : table.locator('tbody > tr').filter({ hasText: rowName }).first();
  const cells = (await row.locator('td').allInnerTexts()).map((t) => t.trim());
  const [, orders, gross, discounts, refunds, fee, net] = cells;
  return {
    orders: Number(orders),
    gross: parseMoney(gross ?? ''),
    discounts: parseMoney(discounts ?? ''),
    refunds: parseMoney(refunds ?? ''),
    fee: parseMoney(fee ?? ''),
    net: parseMoney(net ?? ''),
  };
};

/** gross - discounts - refunds - fee = net, as read from the page. */
export const expectIdentity = (row: Awaited<ReturnType<typeof reportRow>>) => {
  expect(row.gross - row.discounts - row.refunds - row.fee).toBe(row.net);
};

/** Waits, reloading, until the check passes: recording is background work. */
export const expectAfterEarningsReload = async (
  page: Page,
  check: () => Promise<void>,
) => {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout: 45_000 });
};

/** Opens a course row's orders and returns the orders table. */
export const showOrders = async (
  page: Page,
  title: string,
): Promise<Locator> => {
  const row = page
    .getByRole('table', { name: 'Earnings in USD' })
    .locator('tbody > tr')
    .filter({ hasText: title })
    .first();
  const toggle = row.getByRole('button', { name: /orders$/ });
  if ((await toggle.textContent()) === 'Show orders') await toggle.click();
  const orders = page.getByRole('table', { name: 'Orders' });
  await expect(orders).toBeVisible();
  return orders;
};

/**
 * The instructor's id and open entries, found from an order reference shown on
 * the page: the report never names the instructor.
 */
export const instructorOf = async (orderId: string) => {
  const coreTable = await createCoreTableService();
  const { data } = await coreTable.entities.earningOrder.get({ orderId }).go();
  const instructorId = data?.instructorIds[0];
  if (!instructorId) throw new Error(`No earnings recorded for ${orderId}`);
  return { coreTable, instructorId };
};

/**
 * Makes the instructor's open earnings payable now, as the hold period
 * passing would. The local stage holds a sale for a day (`releaseAt` is
 * read-only to updates), so the entries are written again with a release time
 * in the past.
 */
export const releaseEarnings = async (orderId: string) => {
  const { coreTable, instructorId } = await instructorOf(orderId);
  const past = new Date(Date.now() - 60_000).toISOString();
  for (const entry of await openEntries({ coreTable, instructorId })) {
    if (new Date(entry.releaseAt).getTime() <= Date.now()) continue;
    await coreTable.entities.earningEntry
      .put({ ...entry, releaseAt: past })
      .go();
  }
};
