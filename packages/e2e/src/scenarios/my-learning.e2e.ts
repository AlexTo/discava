/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, test } from '@playwright/test';
import { createPublishedCourse } from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import {
  enrol,
  expectAfterReloads,
  markItemDone,
  openCourse,
  startFirstLesson,
} from '../helpers/student-portal.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// A student's own view of their learning: My Learning sorts their courses into
// in progress and completed, the home page offers to continue where they left
// off, and signing out leaves them on the public pages.
test('a student keeps track of their courses, then signs out', async ({
  browser,
}) => {
  const finished = uniqueName('E2E finished course');
  const unfinished = uniqueName('E2E unfinished course');
  const instructor = await browser.newPage();
  const student = await browser.newPage();

  await test.step('an instructor publishes two courses', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Ivy', ['instructor']));
    await createPublishedCourse(instructor, {
      title: finished,
      readings: ['Only reading'],
    });
    await createPublishedCourse(instructor, {
      title: unfinished,
      readings: ['First reading', 'Second reading'],
    });
  });

  await test.step('a student finishes one and starts the other', async () => {
    await openCourse(student, finished);
    await enrol(student, newUser('Sam', ['student']));
    await startFirstLesson(student);
    await markItemDone(student, 'Only reading');

    await openCourse(student, unfinished);
    await enrol(student);
    await startFirstLesson(student);
    await markItemDone(student, 'First reading');
  });

  await test.step('My Learning sorts them into in progress and completed', async () => {
    await student
      .getByRole('banner')
      .getByRole('link', { name: 'My Learning' })
      .click();
    await expectAfterReloads(student, async () => {
      await expect(
        student.getByRole('tab', { name: 'In progress (1)' }),
      ).toBeVisible({ timeout: 2_000 });
      await expect(
        student.getByRole('tab', { name: 'Completed (1)' }),
      ).toBeVisible();
    });
    await expect(
      student.getByRole('link', { name: `Continue: ${unfinished}` }),
    ).toBeVisible();

    await student.getByRole('tab', { name: 'Completed (1)' }).click();
    await expect(
      student.getByRole('link', { name: `Review: ${finished}` }),
    ).toBeVisible();
  });

  await test.step('the home page offers to continue the unfinished one', async () => {
    await student.goto(PORTALS.student);
    await expect(
      student.getByRole('heading', { level: 1, name: 'Welcome back, Sam' }),
    ).toBeVisible();
    await expect(
      student.getByRole('link', { name: `Continue: ${unfinished}` }).first(),
    ).toBeVisible();
  });

  await test.step('signing out leaves them signed out', async () => {
    await student.getByRole('button', { name: 'Open user menu' }).click();
    await student.getByRole('menuitem', { name: 'Sign out' }).click();
    await student.waitForURL(`${PORTALS.student}/`);
    await expect(student.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(
      student.getByRole('link', { name: 'My Learning' }),
    ).toHaveCount(0);
  });
});
