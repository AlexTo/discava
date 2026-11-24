/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { PORTALS, SERVICES } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { expect, test } from '../helpers/table-invariants.js';
import { unsubscribePageUrl } from '../helpers/unsubscribe-link.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

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

  // A switch's name is its label: clicking the text turns it back.
  const switchId = await changeable.getAttribute('id');
  await page.locator(`label[for="${switchId}"]`).click();
  await expect(changeable).toHaveAttribute('aria-checked', String(wasOn));
  await screenshot(page, 'settings after clicking a switch’s name');

  // The hit area is measured from inside the 1px border, so it reaches 1px
  // past the track, top and bottom: a click half a pixel below flips it.
  await changeable.scrollIntoViewIfNeeded();
  const track = await changeable.boundingBox();
  expect(track).not.toBeNull();
  await page.mouse.click(
    track!.x + track!.width / 2,
    track!.y + track!.height + 0.5,
  );
  await expect(changeable).toHaveAttribute('aria-checked', String(!wasOn));
  await screenshot(page, 'settings after clicking the edge of a switch');
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

// The link in an email opens the page without signing in; only its button
// switches the emails off, and the page can switch them back on.
test('an unsubscribe link stops a type of email only when the button is pressed', async ({
  page,
}) => {
  const link = unsubscribePageUrl(
    uniqueName('e2e-unsubscribe').replace(/ /g, '-'),
    'assignment.returned',
  );

  await page.goto(link);
  await expect(
    page.getByRole('heading', { name: 'Stop Assignment returned emails?' }),
  ).toBeVisible();
  await screenshot(page, 'unsubscribe link that is valid');

  await page.getByRole('button', { name: 'Stop these emails' }).click();
  await expect(
    page.getByText("You won't get Assignment returned emails any more."),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Notification settings' }),
  ).toBeVisible();
  await screenshot(page, 'emails stopped');

  await page.getByRole('button', { name: 'Turn them back on' }).click();
  await expect(
    page.getByText('Assignment returned emails are back on.'),
  ).toBeVisible();
  await screenshot(page, 'emails turned back on');
});

test('an unsubscribe link says so when the API cannot be reached', async ({
  page,
}) => {
  await page.route(`${SERVICES.coreApi}unsubscribe/**`, (route) =>
    route.fulfill({ status: 500, body: '{}' }),
  );
  await page.goto(
    unsubscribePageUrl('e2e-unsubscribe-error', 'assignment.returned'),
  );

  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await screenshot(page, 'unsubscribe link with an error and Try again');
});
