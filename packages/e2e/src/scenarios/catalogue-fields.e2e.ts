/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { apiUser } from '../helpers/api.js';
import { createCategory } from '../helpers/catalogue.js';
import {
  addLesson,
  addModule,
  addTextItem,
  createCourse,
  publishCourse,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { expectAfterReloads } from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// An instructor describes a course (category, tags, level, language,
// duration) in the course editor; the search entry follows the stream within
// a few seconds, so each check keeps reloading rather than looking once.
test('an instructor describes a course and it is found by facet', async ({
  browser,
}) => {
  const title = uniqueName('E2E described course');
  const scope = uniqueName('described').toLowerCase().replace(/\s+/g, '-');
  const first = await createCategory(uniqueName('Described one'));
  const second = await createCategory(uniqueName('Described two'));
  const instructor = await browser.newPage();
  const visitor = await browser.newPage();

  const openByScope = () =>
    visitor.goto(
      `${PORTALS.student}/search?tags=${encodeURIComponent(JSON.stringify([scope]))}`,
    );

  await test.step('the instructor sets the five fields and publishes', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Dee', ['instructor']));
    await createCourse(instructor, {
      title,
      summary: 'A course described by the end-to-end tests.',
    });
    await addModule(instructor, 'Module one');
    await addLesson(instructor, 'Lesson one');
    await addTextItem(instructor, { title: 'Reading one', body: 'Hello.' });

    await instructor.getByLabel('Category').selectOption(first.categoryId);
    await instructor.getByLabel('Level').selectOption('intermediate');
    await instructor.getByLabel('Language', { exact: true }).selectOption('de');
    await instructor.getByLabel('Duration (hours)').fill('6');
    await instructor.getByLabel('Tags').fill(scope);
    await instructor.getByLabel('Tags').press('Enter');
    await instructor
      .getByRole('button', { name: 'Save catalogue details' })
      .click();
    await expect(instructor.getByText('Saved', { exact: true })).toBeVisible();
    await screenshot(instructor, 'catalogue-details-saved');
    await publishCourse(instructor);
  });

  await test.step('a visitor finds it under the matching facet values', async () => {
    await expectAfterReloads(visitor, async () => {
      await openByScope();
      await expect(visitor.getByRole('link', { name: title })).toBeVisible({
        timeout: 2_000,
      });
    });
    await expect(
      visitor.getByRole('checkbox', { name: 'Intermediate (1)', exact: true }),
    ).toBeVisible();
    await expect(
      visitor.getByRole('checkbox', { name: 'German (1)', exact: true }),
    ).toBeVisible();
    await expect(
      visitor.getByRole('checkbox', {
        name: `${first.name} (1)`,
        exact: true,
      }),
    ).toBeVisible();
    await screenshot(visitor, 'found-by-facets');
  });

  await test.step('changing the category moves it', async () => {
    await instructor.getByLabel('Category').selectOption(second.categoryId);
    await instructor
      .getByRole('button', { name: 'Save catalogue details' })
      .click();
    await expect(instructor.getByText('Saved', { exact: true })).toBeVisible();

    await expectAfterReloads(visitor, async () => {
      await openByScope();
      await expect(
        visitor.getByRole('checkbox', {
          name: `${second.name} (1)`,
          exact: true,
        }),
      ).toBeVisible({ timeout: 2_000 });
    });
    await expect(
      visitor.getByRole('checkbox', { name: `${first.name} (1)` }),
    ).toHaveCount(0);
  });
});

test('a student cannot set a course’s catalogue details', async () => {
  const instructor = await apiUser('Ida', ['instructor']);
  const { courseId } = await instructor.instructor.course.create.mutate({
    title: uniqueName('Catalogue guarded'),
  });
  const student = await apiUser('Stu', ['student']);

  await expect(
    student.instructor.course.updateCatalogue.mutate({
      courseId,
      level: 'beginner',
    }),
  ).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
});
