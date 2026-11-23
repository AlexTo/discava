/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  addLesson,
  addModule,
  addTextItem,
  createCourse,
  publishCourse,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// A list's filter, a page's tab and a report's period are in the address, so a
// reload or a shared link shows the same view, and Back steps through them.
test('an instructor reloads and shares the views of My Courses, Questions and Earnings', async ({
  page,
}) => {
  const published = uniqueName('E2E views published');
  const draft = uniqueName('E2E views draft');

  await page.goto(`${PORTALS.instructor}/my-courses`);
  await signIn(page, newUser('Vera', ['instructor']));
  await createCourse(page, {
    title: published,
    summary: 'A published course for the views scenario.',
  });
  await addModule(page, 'Module one');
  await addLesson(page, 'Lesson one');
  await addTextItem(page, { title: 'Reading', body: 'Text.' });
  await publishCourse(page);
  const courseId = page.url().split('/').pop()!;
  await createCourse(page, {
    title: draft,
    summary: 'A draft course for the views scenario.',
  });

  await test.step('My Courses keeps its filter and search across a reload, and Back returns to All', async () => {
    await page.goto(`${PORTALS.instructor}/my-courses`);
    await expect(page.getByText(published)).toBeVisible();
    await expect(page.getByText(draft)).toBeVisible();

    await page.getByRole('radio', { name: 'Show draft courses' }).click();
    await expect(page).toHaveURL(/status=draft/);
    await page.getByLabel('Search courses').fill('views');
    await expect(page).toHaveURL(/q=views/);

    await page.reload();
    await expect(
      page.getByRole('radio', { name: 'Show draft courses' }),
    ).toBeChecked();
    await expect(page.getByLabel('Search courses')).toHaveValue('views');
    await expect(page.getByText(draft)).toBeVisible();
    await expect(page.getByText(published)).toBeHidden();
    await screenshot(page, 'my courses filtered from the address');

    await page.goBack();
    await expect(
      page.getByRole('radio', { name: 'Show all courses' }),
    ).toBeChecked();
    await expect(page.getByText(published)).toBeVisible();
  });

  await test.step('Questions keeps its tab across a reload', async () => {
    await page.goto(`${PORTALS.instructor}/my-courses/${courseId}/questions`);
    await page.getByRole('tab', { name: 'Reported' }).click();
    await expect(page).toHaveURL(/tab=reported/);

    await page.reload();
    await expect(page.getByRole('tab', { name: 'Reported' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  await test.step('Earnings keeps its month across a reload', async () => {
    await page.goto(`${PORTALS.instructor}/earnings`);
    const month = page.getByLabel('Month (UTC)');
    const now = new Date();
    const previous = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    )
      .toISOString()
      .slice(0, 7);
    await month.fill(previous);
    await expect(page).toHaveURL(new RegExp(`month=${previous}`));

    await page.reload();
    await expect(page.getByLabel('Month (UTC)')).toHaveValue(previous);
  });
});
