/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, test } from '@playwright/test';
import {
  addLesson,
  addModule,
  addTextItem,
  createCourse,
  publishCourse,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import {
  enrol,
  openCourse,
  startFirstLesson,
} from '../helpers/student-portal.js';
import { newUser, signIn, testUser, uniqueName } from '../helpers/users.js';

// Who may see what, checked from the portals: the APIs refuse, and the pages
// show nothing they shouldn't.
test.describe('access', () => {
  const published = uniqueName('E2E access course');
  const draft = uniqueName('E2E draft course');
  const reading = 'Only for enrolled students.';
  let courseUrl: string;
  let lessonUrl: string;

  // A new instructor's published course with one reading, and a draft. The
  // lesson's URL is what an enrolled student would have, so a throwaway
  // student enrols to get it.
  test.beforeAll(async ({ browser }) => {
    const instructor = await browser.newPage();
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Ivy', ['instructor']));
    await createCourse(instructor, { title: draft, summary: 'Not published.' });
    await createCourse(instructor, {
      title: published,
      summary: 'A course for the access checks.',
    });
    courseUrl = instructor.url();
    await addModule(instructor, 'Module one');
    await addLesson(instructor, 'Lesson one');
    await addTextItem(instructor, { title: 'Reading one', body: reading });
    await publishCourse(instructor);

    const student = await browser.newPage();
    await openCourse(student, published);
    await enrol(student, newUser('Sam', ['student']));
    await startFirstLesson(student);
    lessonUrl = student.url();
  });

  test('a student is turned away from the instructor portal', async ({
    page,
  }) => {
    await page.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(page, testUser('Bob'));

    await expect(
      page.getByRole('heading', {
        name: 'The instructor portal is for instructors',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Go to the student portal' }),
    ).toHaveAttribute('href', PORTALS.student);
    await expect(
      page.getByRole('button', { name: 'Create course' }),
    ).toHaveCount(0);

    // Signing out (e.g. to sign in as someone else) goes back to sign-in.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.goto(`${PORTALS.instructor}/my-courses`);
    await page.waitForURL(/localhost:9400\/discava\/authorize/);
  });

  test('only admins get the admin portal; others are pointed to theirs', async ({
    browser,
  }) => {
    const student = await browser.newPage();
    await student.goto(PORTALS.admin);
    await signIn(student, testUser('Bob'));
    await expect(
      student.getByRole('heading', {
        name: 'The admin portal is for administrators',
      }),
    ).toBeVisible();
    await expect(
      student.getByRole('link', { name: 'Go to the student portal' }),
    ).toHaveAttribute('href', PORTALS.student);
    await expect(
      student.getByRole('link', { name: 'Go to the instructor portal' }),
    ).toHaveCount(0);

    // An instructor who isn't an admin can also go to the instructor portal.
    const instructor = await browser.newPage();
    await instructor.goto(PORTALS.admin);
    await signIn(instructor, testUser('Alice'));
    await expect(
      instructor.getByRole('link', { name: 'Go to the instructor portal' }),
    ).toHaveAttribute('href', PORTALS.instructor);
  });

  test("an instructor can't open a course they don't teach", async ({
    page,
  }) => {
    await page.goto(courseUrl);
    await signIn(page, testUser('Alice'));

    await expect(page.getByText("Couldn't load this course")).toBeVisible();
    await expect(page.getByRole('heading', { name: published })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0);
  });

  test("a student who isn't enrolled can't open a lesson", async ({ page }) => {
    await page.goto(lessonUrl);
    await signIn(page, testUser('Dan'));

    await expect(
      page.getByRole('heading', { name: 'Enrol to start learning' }),
    ).toBeVisible();
    await expect(page.getByText(reading)).toHaveCount(0);
  });

  test("students can't find a draft course", async ({ page }) => {
    await page.goto(
      `${PORTALS.student}/search?query=${encodeURIComponent(draft)}`,
    );

    await expect(page.getByText('No courses match your search.')).toBeVisible();
    await expect(page.getByRole('link', { name: draft })).toHaveCount(0);
  });
});
