/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { PORTALS } from '../helpers/portals.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// Sample content a real instructor's home page must never show.
const SAMPLE_STRINGS = [
  'Applied Mathematics',
  'Foundations of Biology',
  'Academic Communication',
  'Mia Chen',
  'Oliver Smith',
  '33 submissions',
  'Needs attention',
  'Recent activity',
  'Upcoming',
  'Open grading queue',
  'Create an assignment',
];

// The instructor home page lists the signed-in instructor's own courses: a
// new instructor starts with none, and a course they create shows up there.
test('a new instructor sees their real courses on the home page', async ({
  page,
}) => {
  const course = uniqueName('E2E home course');

  await test.step('a new instructor sees the empty state and nothing invented', async () => {
    await page.goto(`${PORTALS.instructor}/`);
    await signIn(page, newUser('Hana', ['instructor']));
    await expect(
      page.getByText("You don't teach any courses yet"),
    ).toBeVisible();
    for (const sample of SAMPLE_STRINGS) {
      await expect(page.getByText(sample)).toHaveCount(0);
    }
  });

  await test.step('a course created from the home page is listed when they return', async () => {
    await page.getByRole('button', { name: 'Create a course' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Create a course' });
    await dialog.getByLabel('Course title').fill(course);
    await dialog
      .getByLabel('Course summary')
      .fill('A course the home page end-to-end test creates.');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await page.waitForURL(/\/my-courses\/[0-9a-f-]+$/);
    await expect(
      page.getByRole('heading', { level: 1, name: course }),
    ).toBeVisible();

    await page.goto(`${PORTALS.instructor}/`);
    await expect(
      page.getByRole('link', { name: new RegExp(course) }),
    ).toBeVisible();
    await expect(page.getByText("You don't teach any courses yet")).toHaveCount(
      0,
    );
  });

  await test.step('opening it from its card loads the editor', async () => {
    await page.getByRole('link', { name: new RegExp(course) }).click();
    await page.waitForURL(/\/my-courses\/[0-9a-f-]+$/);
    await expect(
      page.getByRole('heading', { level: 1, name: course }),
    ).toBeVisible();
    await expect(page.getByText("You don't have permission")).toHaveCount(0);
  });
});
