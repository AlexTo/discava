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
  const titles: Record<string, string> = {
    '/': 'Home · Discava',
    '/categories': 'Categories · Discava',
    '/reviews': 'Reviews · Discava',
    '/certificates': 'Certificates · Discava',
    '/payments': 'Payments · Discava',
    '/settings/branding': 'Branding · Settings · Discava',
    '/settings/notifications': 'Notification settings · Settings · Discava',
  };

  await test.step('the home page has a card for each area', async () => {
    await expect(
      page.getByRole('heading', { level: 1, name: 'Admin' }),
    ).toBeVisible();
    for (const { title } of areas) {
      await expect(
        page.getByRole('main').getByRole('link', { name: title }),
      ).toBeVisible();
    }
    await expect(page).toHaveTitle(titles['/']);
    await screenshot(page, 'admin home with six cards');
  });

  await test.step('Categories says what it is waiting for while its list loads', async () => {
    // Held, not failed: the list request answers once the screenshot is taken.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/localhost:2025\/.*category\.list/, async (route) => {
      await held;
      await route.continue();
    });
    await page.goto(`${PORTALS.admin}/categories`);
    await expect(page.getByRole('status')).toContainText(
      'Loading the categories…',
    );
    await screenshot(page, 'admin categories loading');
    release();
    await page.unroute(/localhost:2025\/.*category\.list/);
  });

  for (const { title, path, heading } of areas) {
    await test.step(`the ${title} card opens its page`, async () => {
      await page.goto(PORTALS.admin);
      await page.getByRole('main').getByRole('link', { name: title }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(
        page.getByRole('heading', { level: 1, name: heading }),
      ).toBeVisible();
      await expect(page).toHaveTitle(titles[path]);
    });
  }

  await test.step('an address with no page says so and leads home', async () => {
    await page.goto(`${PORTALS.admin}/no-such-page`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeVisible();
    await expect(page).toHaveTitle('Page not found · Discava');
    await screenshot(page, 'admin page not found');
    await page.getByRole('link', { name: 'Go to the home page' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Admin' }),
    ).toBeVisible();
  });
});
