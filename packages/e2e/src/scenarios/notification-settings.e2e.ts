/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn } from '../helpers/users.js';

// Which notification emails someone gets is set on a settings page in each
// portal, reached from the user menu; a switch saves as it is flipped.
test('a student switches a notification email off in settings', async ({
  page,
}) => {
  await page.goto(`${PORTALS.student}/my-learning`);
  await signIn(page, newUser('Sade', ['student']));

  await page.getByRole('button', { name: 'Open user menu' }).click();
  await page.getByRole('menuitem', { name: 'Notification settings' }).click();
  await expect(
    page.getByRole('heading', { name: 'Notification settings' }),
  ).toBeVisible();
  const toggles = page.getByRole('switch');
  await expect(toggles.first()).toBeVisible();
  await screenshot(page, 'settings with every type listed');

  const changeable = page.getByRole('switch', { disabled: false }).first();
  const wasOn = (await changeable.getAttribute('aria-checked')) === 'true';
  await changeable.click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(changeable).toHaveAttribute('aria-checked', String(!wasOn));
  await screenshot(page, 'settings after a switch was saved');
});

test('an instructor and an admin reach settings from their user menus', async ({
  browser,
}) => {
  const instructor = await browser.newPage();
  await instructor.goto(`${PORTALS.instructor}/my-courses`);
  await signIn(instructor, newUser('Ines', ['instructor']));
  await instructor.getByRole('button', { name: 'Open user menu' }).click();
  await instructor
    .getByRole('menuitem', { name: 'Notification settings' })
    .click();
  await expect(
    instructor.getByRole('heading', { name: 'Notification settings' }),
  ).toBeVisible();
  await expect(instructor.getByRole('switch').first()).toBeVisible();
  await screenshot(instructor, 'instructor portal settings');

  const admin = await browser.newPage();
  await admin.goto(`${PORTALS.admin}/categories`);
  await signIn(admin, newUser('Adel', ['admin']));
  await admin.getByRole('button', { name: 'Open user menu' }).click();
  await admin.getByRole('menuitem', { name: 'Notification settings' }).click();
  await expect(
    admin.getByRole('heading', { name: 'Notification settings' }),
  ).toBeVisible();
  await expect(admin.getByRole('switch').first()).toBeVisible();
  await screenshot(admin, 'admin portal settings');
});

// The link in an email opens without signing in; one that was changed, or
// with no token, says so and offers nothing to press.
test('an unsubscribe link that is not valid offers nothing to press', async ({
  page,
}) => {
  await page.goto(`${PORTALS.student}/unsubscribe?token=not-a-real-token`);
  await expect(page.getByText('This link is not valid.')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Stop these emails' }),
  ).toHaveCount(0);
  await screenshot(page, 'unsubscribe link that is not valid');
});
