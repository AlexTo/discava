/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn } from '../helpers/users.js';

// A new instructor has earned nothing: the Earnings page, reached from the
// navigation, shows each section without inventing figures. Purchases, refunds
// and payouts are covered by the end-to-end scenarios of the last phase.
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
