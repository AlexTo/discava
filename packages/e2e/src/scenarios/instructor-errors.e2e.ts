/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Route } from '@playwright/test';
import {
  addLesson,
  addModule,
  createCourse,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

const abort = (route: Route) => route.abort('connectionfailed');

// Errors and blocked actions say what to do next: a failed load or save names
// the problem in words, never "Failed to fetch", and offers Try again that
// recovers once the network does.
test('an instructor sees what to do next when a request fails or an action is blocked', async ({
  page,
}) => {
  await page.goto(`${PORTALS.instructor}/my-courses`);
  await signIn(page, newUser('Eri', ['instructor']));

  await test.step('a brand-new instructor is invited to create a first course', async () => {
    await expect(
      page.getByText("You don't teach any courses yet"),
    ).toBeVisible();
    await expect(page.getByText('No courses found')).toBeHidden();
    await screenshot(page, 'new instructor my courses');
  });

  await test.step('My Courses says it could not reach Discava, and Try again recovers it', async () => {
    await page.route('**/course.listByInstructor*', abort);
    await page.reload();
    await expect(page.getByText("Couldn't load your courses")).toBeVisible();
    await expect(page.getByText(/Couldn't reach Discava/)).toBeVisible();
    await expect(page.getByText('Failed to fetch')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(
      1,
    );
    await screenshot(page, 'my courses error with try again');

    await page.unroute('**/course.listByInstructor*', abort);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(
      page.getByText("You don't teach any courses yet"),
    ).toBeVisible();
    await expect(page.getByText("Couldn't load your courses")).toBeHidden();
  });

  await test.step('the course editor offers Try again, and a draft course asks to be published before announcements', async () => {
    await createCourse(page, {
      title: uniqueName('E2E errors course'),
      summary: 'A course for the errors scenario.',
    });
    await expect(
      page.getByText('Publish the course to post announcements.'),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Post announcement' }),
    ).toHaveCount(0);
    await screenshot(page, 'draft course announcements');

    await page.route('**/course.view*', abort);
    await page.reload();
    await expect(page.getByText("Couldn't load this course")).toBeVisible();
    await expect(page.getByText('Failed to fetch')).toHaveCount(0);
    await screenshot(page, 'course editor error with try again');

    await page.unroute('**/course.view*', abort);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText("Couldn't load this course")).toBeHidden();
  });

  await test.step('a quiz that cannot be saved says so, and Save works once the network is back', async () => {
    await addModule(page, 'Module one');
    await addLesson(page, 'Lesson one');
    await page
      .getByRole('button', { name: 'Quiz', exact: true })
      .last()
      .click();
    const dialog = page.getByRole('dialog', { name: 'New quiz' });
    await dialog.getByLabel('Title', { exact: true }).fill('Quiz one');
    await dialog.getByLabel('Question 1', { exact: true }).fill('2 + 2?');
    await dialog.getByLabel('Option 1', { exact: true }).fill('3');
    await dialog.getByLabel('Option 2', { exact: true }).fill('4');
    await dialog.getByRole('radio', { name: 'Option 2 is correct' }).check();

    await page.route('**/contentItem.createQuiz*', abort);
    await dialog.getByRole('button', { name: 'Save quiz' }).click();
    await expect(dialog.getByText("Couldn't save the quiz")).toBeVisible();
    await expect(dialog.getByText(/Couldn't reach Discava/)).toBeVisible();
    await expect(page.getByText('Failed to fetch')).toHaveCount(0);
    await screenshot(page, 'quiz save error');

    await page.unroute('**/contentItem.createQuiz*', abort);
    await dialog.getByRole('button', { name: 'Save quiz' }).click();
    await expect(dialog.getByRole('status')).toHaveText('Saved');
  });
});
