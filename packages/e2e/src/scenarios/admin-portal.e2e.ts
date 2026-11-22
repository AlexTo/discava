/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn } from '../helpers/users.js';

// The admin home page lists every area, and an address with no page says so
// and leads back home.
test('the admin home page leads to every area, and a missing page leads home', async ({
  page,
}) => {
  await page.goto(PORTALS.admin);
  await signIn(page, newUser('Hana', ['admin']));

  const areas = [
    { title: 'Categories', path: '/categories', heading: 'Categories' },
    { title: 'Reviews', path: '/reviews', heading: 'Reviews' },
    { title: 'Certificates', path: '/certificates', heading: 'Certificates' },
    { title: 'Payments', path: '/payments', heading: 'Payments' },
    { title: 'Branding', path: '/settings/branding', heading: 'Branding' },
    {
      title: 'Notification settings',
      path: '/settings/notifications',
      heading: 'Notification settings',
    },
  ];

  await test.step('the home page has a card for each area', async () => {
    await expect(
      page.getByRole('heading', { level: 1, name: 'Admin' }),
    ).toBeVisible();
    for (const { title } of areas) {
      await expect(
        page.getByRole('main').getByRole('link', { name: title }),
      ).toBeVisible();
    }
    await screenshot(page, 'admin home with six cards');
  });

  for (const { title, path, heading } of areas) {
    await test.step(`the ${title} card opens its page`, async () => {
      await page.goto(PORTALS.admin);
      await page.getByRole('main').getByRole('link', { name: title }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(
        page.getByRole('heading', { level: 1, name: heading }),
      ).toBeVisible();
    });
  }

  await test.step('an address with no page says so and leads home', async () => {
    await page.goto(`${PORTALS.admin}/no-such-page`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeVisible();
    await screenshot(page, 'admin page not found');
    await page.getByRole('link', { name: 'Go to the home page' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Admin' }),
    ).toBeVisible();
  });
});
