/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { createPublishedCourseViaApi } from '../helpers/api.js';
import { apiUserFor } from '../helpers/assignment.js';
import { PORTALS } from '../helpers/portals.js';
import { PHONE } from '../helpers/viewport.js';
import { screenshot } from '../helpers/screenshots.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// Every instructor page says where you are: a title, one h1 and one main, in
// the states a page passes through, and the h1 takes focus after navigation.
test('every instructor page has a title, one h1 and one main', async ({
  page,
}) => {
  const ivy = newUser('Ivy', ['instructor']);
  const courseTitle = uniqueName('E2E pages course');
  const { courseId } = await createPublishedCourseViaApi(
    await apiUserFor(ivy),
    courseTitle,
  );

  const pages: { path: string; title: string | RegExp }[] = [
    { path: '/', title: 'Home · Discava' },
    { path: '/dashboard', title: 'Dashboard · Discava' },
    {
      path: `/dashboard/${courseId}`,
      title: `${courseTitle} · Dashboard · Discava`,
    },
    { path: '/my-courses', title: 'My Courses · Discava' },
    {
      path: `/my-courses/${courseId}`,
      title: `${courseTitle} · My Courses · Discava`,
    },
    {
      path: `/my-courses/${courseId}/questions`,
      title: `Questions · ${courseTitle} · Discava`,
    },
    {
      path: `/my-courses/${courseId}/reviews`,
      title: `Reviews · ${courseTitle} · Discava`,
    },
    { path: '/earnings', title: 'Earnings · Discava' },
    { path: '/profile', title: 'Profile · Discava' },
    {
      path: '/settings/notifications',
      title: 'Notification settings · Discava',
    },
    { path: '/no-such-page', title: 'Page not found · Discava' },
  ];

  await page.goto(`${PORTALS.instructor}/`);
  await signIn(page, ivy);

  for (const { path, title } of pages) {
    await test.step(`${path} has its title, one h1 and one main`, async () => {
      await page.goto(`${PORTALS.instructor}${path}`);
      await expect(page).toHaveTitle(title);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('main')).toHaveCount(1);
    });
  }

  await test.step('the h1 takes focus after following a link', async () => {
    await page.goto(`${PORTALS.instructor}/`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const earnings = page.getByRole('link', { name: 'Earnings' }).first();
    await earnings.focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/earnings$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Earnings' }),
    ).toBeFocused();
  });

  await test.step('at phone width, a link from the open sidebar leaves focus on the new h1', async () => {
    await page.setViewportSize(PHONE);
    await page.goto(`${PORTALS.instructor}/`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
    const sidebar = page.getByRole('dialog');
    await expect(sidebar).toBeVisible();
    await sidebar.getByRole('link', { name: 'Earnings' }).focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/earnings$/);
    await expect(sidebar).toBeHidden();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Earnings' }),
    ).toBeFocused();
    await screenshot(page, 'phone sidebar link leaves focus on the new h1');
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  await test.step('a course that fails to load still has one h1', async () => {
    await page.route('**/course.view*', (route) => route.abort());
    await page.goto(`${PORTALS.instructor}/my-courses/${courseId}`);
    await expect(page.getByText("Couldn't load this course")).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page).toHaveTitle('Course · Discava');
    await screenshot(page, 'course editor load error');
  });

  await test.step('a title that cannot load leaves a neutral crumb, never the id', async () => {
    const trail = page.getByRole('navigation', { name: 'breadcrumb' });

    await page.goto(`${PORTALS.instructor}/my-courses/${courseId}`);
    await expect(page.getByText("Couldn't load this course")).toBeVisible();
    await expect(trail.getByText('Course', { exact: true })).toBeVisible();
    await expect(trail).not.toContainText(courseId);
    await screenshot(page, 'course editor breadcrumb without its title');

    await page.route('**/analytics.courseSummaries*', (route) => route.abort());
    await page.goto(`${PORTALS.instructor}/dashboard/${courseId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(trail.getByText('Course', { exact: true })).toBeVisible();
    await expect(trail).not.toContainText(courseId);
    await screenshot(page, 'course analytics breadcrumb without its title');
  });
});
