/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  lessonRow,
  markFreePreview,
  removeFreePreview,
} from '../helpers/free-preview.js';
import {
  addLesson,
  addModule,
  addUploadAssignment,
  createCourse,
  publishCourse,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// Free preview lessons: an instructor marks an ordinary lesson in the course
// editor. The mark is independent of whether the course is published; the
// badge says whether anyone can open the lesson yet.
test.describe('an instructor marks a lesson as a free preview', () => {
  test('marks and unmarks an ordinary lesson, and an assignment has no control', async ({
    page,
  }) => {
    const course = uniqueName('E2E free preview course');

    await page.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(page, newUser('Ivy', ['instructor']));
    await createCourse(page, {
      title: course,
      summary: 'A course whose first lesson is a free preview.',
    });
    await addModule(page, 'Module one');
    await addLesson(page, 'Welcome');
    await addUploadAssignment(page, {
      title: 'Essay',
      instructions: 'Write about the lesson.',
      maxPoints: 10,
    });

    await test.step('the lesson is marked after a confirmation', async () => {
      await markFreePreview(page, 'Welcome', {
        beforeConfirm: () => screenshot(page, 'confirm-free-preview'),
      });
      await expect(
        lessonRow(page, 'Welcome').getByText('Free preview (not public yet)'),
      ).toBeVisible();
      await screenshot(page, 'badge-draft-course');
    });

    await test.step('an assignment lesson has no control', async () => {
      await expect(
        lessonRow(page, 'Essay').getByRole('button', {
          name: /free preview/i,
        }),
      ).toHaveCount(0);
    });

    await test.step('publishing the course makes the badge plain', async () => {
      await publishCourse(page);
      await expect(
        lessonRow(page, 'Welcome').getByText('Free preview', { exact: true }),
      ).toBeVisible();
      await screenshot(page, 'badge-published-course');
    });

    await test.step('the mark is removed at once', async () => {
      await removeFreePreview(page, 'Welcome');
      await expect(
        lessonRow(page, 'Welcome').getByText(/^Free preview/),
      ).toHaveCount(0);
    });
  });
});
