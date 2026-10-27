/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  addLesson,
  addModule,
  addTextItem,
  archiveItem,
  createCourse,
  hideItem,
  moveItemUp,
  publishCourse,
  publishItem,
  restoreItem,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import {
  enrol,
  expectAfterReloads,
  lessonItem,
  lessonSteps,
  markItemDone,
  openCourse,
  startFirstLesson,
} from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// Changing a course after it's published: what an enrolled student sees, and
// what happens to their progress, as the instructor hides, publishes,
// archives, restores and reorders content. Progress is recalculated from the
// core table's stream after each change.
test('an instructor reworks a published course while a student is taking it', async ({
  browser,
}) => {
  const course = uniqueName('E2E lifecycle course');
  const instructor = await browser.newPage();
  const student = await browser.newPage();
  let lessonUrl = '';
  let courseHome = '';

  await test.step('the instructor publishes a lesson with two readings', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Ivy', ['instructor']));
    await createCourse(instructor, {
      title: course,
      summary: 'A course the end-to-end tests change after publishing.',
    });
    await addModule(instructor, 'Module one');
    await addLesson(instructor, 'Lesson one');
    await addTextItem(instructor, { title: 'Reading A', body: 'First.' });
    await addTextItem(instructor, { title: 'Reading B', body: 'Second.' });
    await publishCourse(instructor);
  });

  await test.step('a student completes reading A: half the course', async () => {
    await openCourse(student, course);
    await enrol(student, newUser('Sam', ['student']));
    courseHome = student.url();
    await startFirstLesson(student);
    lessonUrl = student.url();
    await expect(lessonSteps(student)).toHaveText([/Reading A/, /Reading B/]);
    await markItemDone(student, 'Reading A');
    // Through the app, as a student would: the page keeps checking for the
    // recalculated progress (#237), which a fresh page load wouldn't know to.
    await student.getByRole('link', { name: course }).click();
    await expect(
      student.getByText('50% complete', { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
  });

  await test.step('hiding reading B leaves only what they did: course complete', async () => {
    await hideItem(instructor, 'text', 'Reading B');

    await student.goto(lessonUrl);
    await expectAfterReloads(student, async () => {
      await expect(lessonItem(student, 'Reading A')).toBeVisible();
      await expect(lessonItem(student, 'Reading B')).toHaveCount(0);
    });
    await student.goto(courseHome);
    await expectAfterReloads(student, async () => {
      await expect(
        student.getByText("You've completed this course"),
      ).toBeVisible({ timeout: 2_000 });
    });
  });

  await test.step('publishing it again brings it back', async () => {
    await publishItem(instructor, 'text', 'Reading B');

    await student.goto(lessonUrl);
    await expectAfterReloads(student, async () => {
      await expect(lessonItem(student, 'Reading B')).toBeVisible({
        timeout: 2_000,
      });
    });
  });

  await test.step('archiving it removes it; restoring brings it back', async () => {
    await archiveItem(instructor, 'text', 'Reading B');
    await expectAfterReloads(student, async () => {
      await expect(lessonItem(student, 'Reading B')).toHaveCount(0);
    });

    await restoreItem(instructor, 'text', 'Reading B');
    await expectAfterReloads(student, async () => {
      await expect(lessonItem(student, 'Reading B')).toBeVisible({
        timeout: 2_000,
      });
    });
  });

  await test.step('reordering changes the order students see', async () => {
    await moveItemUp(instructor, 'Reading B');

    await expectAfterReloads(student, async () => {
      await expect(lessonSteps(student)).toHaveText(
        [/Reading B/, /Reading A/],
        { timeout: 2_000 },
      );
    });
  });
});
