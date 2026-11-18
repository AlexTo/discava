/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn } from '../helpers/users.js';

// The shared bell in each portal's header: someone with nothing yet sees no
// badge, and opening it says they're all caught up.
test('a new student opens the bell in the student portal', async ({ page }) => {
  await page.goto(`${PORTALS.student}/my-learning`);
  await signIn(page, newUser('Nia', ['student']));

  const bell = page.getByRole('button', { name: 'Notifications' });
  await expect(bell).toBeVisible();
  await screenshot(page, 'bell with nothing unread');

  await bell.click();
  await expect(page.getByText("You're all caught up.")).toBeVisible();
  await screenshot(page, 'empty list');
});

test('a new instructor opens the bell in the instructor portal', async ({
  page,
}) => {
  await page.goto(`${PORTALS.instructor}/my-courses`);
  await signIn(page, newUser('Ira', ['instructor']));

  await page.getByRole('button', { name: 'Notifications' }).click();
  await expect(page.getByText("You're all caught up.")).toBeVisible();
  await screenshot(page, 'empty list');
});
