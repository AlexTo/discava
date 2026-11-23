/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { apiUser, createPublishedCourseViaApi } from '../helpers/api.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

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
    // The screen's own announcement region is empty and always present.
    const loading = page
      .getByRole('status')
      .filter({ hasText: 'Loading the categories…' });
    await expect(loading).toBeVisible();
    await screenshot(page, 'admin categories loading');
    release();
    // Unrouting while the held request is in flight would make its
    // `route.continue()` fail, so wait for the list to arrive first.
    await expect(loading).toHaveCount(0);
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

// With the keyboard alone, focus stays on the row an action changed.
test('renaming and archiving a category keep focus on that row', async ({
  page,
}) => {
  const first = uniqueName('Keyboard rename');
  const renamed = `${first} renamed`;
  const second = uniqueName('Keyboard archive');
  const row = (name: string) => page.getByRole('row').filter({ hasText: name });

  await page.goto(`${PORTALS.admin}/categories`);
  await signIn(page, newUser('Kay', ['admin']));
  await expect(
    page.getByRole('heading', { level: 1, name: 'Categories' }),
  ).toBeVisible();
  for (const name of [first, second]) {
    await page.getByLabel('New category name').fill(name);
    await page.getByRole('button', { name: 'Add category' }).click();
    await expect(row(name)).toBeVisible();
  }

  await test.step('Rename, type, Enter leaves focus on that row’s Rename', async () => {
    await row(first)
      .getByRole('button', { name: `Rename ${first}` })
      .focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel(`New name for ${first}`)).toBeFocused();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(renamed);
    await page.keyboard.press('Enter');
    await expect(row(renamed)).toBeVisible();
    await expect(
      row(renamed).getByRole('button', { name: `Rename ${renamed}` }),
    ).toBeFocused();
  });

  await test.step('archiving leaves focus on that row’s Rename', async () => {
    await row(second)
      .getByRole('button', { name: `Archive ${second}` })
      .focus();
    await page.keyboard.press('Enter');
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Archive' })
      .click();
    await expect(row(second)).toContainText('Archived');
    await expect(
      row(second).getByRole('button', { name: `Rename ${second}` }),
    ).toBeFocused();
    await screenshot(page, 'categories after keyboard rename and archive');
  });
});

// A problem with the add form is shown under its field, and the field has focus.
test('adding a category with an empty or taken name explains it beside the field', async ({
  page,
}) => {
  const name = uniqueName('Duplicate category');
  const field = page.getByLabel('New category name');

  await page.goto(`${PORTALS.admin}/categories`);
  await signIn(page, newUser('Dee', ['admin']));
  await expect(
    page.getByRole('heading', { level: 1, name: 'Categories' }),
  ).toBeVisible();

  await test.step('an empty name is refused on submit', async () => {
    await page.getByRole('button', { name: 'Add category' }).click();
    await expect(
      page.getByText('Enter a name for the category.'),
    ).toBeVisible();
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
  });

  await test.step('a name that exists is refused under the field', async () => {
    await field.fill(name);
    await page.getByRole('button', { name: 'Add category' }).click();
    await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
    await field.fill(name);
    await page.getByRole('button', { name: 'Add category' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: "Couldn't add the category" }),
    ).toBeVisible();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await screenshot(page, 'duplicate category name beside the add field');
  });
});

// A typed reason is lost only by Cancel: Escape asks first.
test('Escape on Remove review with a reason typed asks before discarding', async ({
  page,
}) => {
  const title = uniqueName('E2E discard guard');
  const instructor = await apiUser('Ivy', ['instructor']);
  const { courseId } = await createPublishedCourseViaApi(instructor, title);
  const student = await apiUser('Sam', ['student']);
  await student.core.course.enrol.mutate({ courseId });
  await student.core.review.post.mutate({
    courseId,
    rating: 1,
    text: 'Rude words about the instructor.',
  });

  await page.goto(`${PORTALS.admin}/reviews`);
  await signIn(page, newUser('Cara', ['admin']));
  await page
    .getByLabel('Course')
    .selectOption({ label: `${title} · 1 rating` });
  await page.getByRole('button', { name: /^Remove .* review$/ }).click();
  await page.getByLabel('Reason').fill('Abusive language');

  await page.keyboard.press('Escape');
  await expect(page.getByText('Discard unsaved changes?')).toBeVisible();
  await screenshot(page, 'Escape on Remove review asks to discard the reason');

  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByLabel('Reason')).toHaveValue('Abusive language');
});
