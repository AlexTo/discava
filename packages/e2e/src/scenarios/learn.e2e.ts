/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Route } from '@playwright/test';
import {
  apiUser,
  createLongTitledCourseViaApi,
  createPublishedQuizCourseViaApi,
} from '../helpers/api.js';
import {
  addLesson,
  addModule,
  addTextItem,
  createCourse,
  hideItem,
  publishCourse,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import {
  enrol,
  enrolAndLand,
  expectCourseCompleted,
  openCourse,
  startFirstLesson,
} from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// The main path through Discava: an instructor builds and publishes a course,
// and a student finds it, enrols and completes it. Completing the reading
// reaches the course's progress through the core table's stream and the
// event runner's progress recalculation.
test('an instructor publishes a course, and a student completes it', async ({
  browser,
}) => {
  const course = uniqueName('E2E course');
  const reading = 'Hello from the end-to-end tests.';
  const instructor = await browser.newPage();
  const student = await browser.newPage();

  await test.step('the instructor builds and publishes the course', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Ivy', ['instructor']));
    await createCourse(instructor, {
      title: course,
      summary: 'A course made by the end-to-end tests.',
    });
    await addModule(instructor, 'Module one');
    await addLesson(instructor, 'Lesson one');
    await addTextItem(instructor, { title: 'Reading one', body: reading });
    await publishCourse(instructor);
  });

  await test.step('a new student finds the course and enrols', async () => {
    await openCourse(student, course);
    await enrol(student, newUser('Sam', ['student']));
    await expect(
      student.getByText('0% complete', { exact: true }),
    ).toBeVisible();
  });

  await test.step('the student reads the lesson and marks it done', async () => {
    await student.getByRole('link', { name: 'Start', exact: true }).click();
    await expect(
      student.getByRole('heading', { name: 'Reading one' }),
    ).toBeVisible();
    await expect(student.getByText(reading)).toBeVisible();
    await student.getByRole('button', { name: 'Mark as done' }).click();
    await expect(student.getByText('1/1 lessons complete')).toBeVisible();
  });

  await test.step('the course shows as completed', async () => {
    await student.getByRole('link', { name: course }).click();
    await expectCourseCompleted(student);
  });
});

// Enrolling opens the learner's next lesson by itself: the first lesson the
// course shows, or the course home when it shows none.
test('enrolling lands in the first shown lesson', async ({ browser }) => {
  const course = uniqueName('E2E landing course');
  const instructor = await browser.newPage();
  const student = await browser.newPage();

  await test.step('the instructor publishes a course whose first lesson is hidden', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Ivy', ['instructor']));
    await createCourse(instructor, {
      title: course,
      summary: 'A course made by the end-to-end tests.',
    });
    await addModule(instructor, 'Module one');
    await addLesson(instructor, 'Hidden lesson');
    await addTextItem(instructor, { title: 'Hidden reading', body: 'Hidden.' });
    await addLesson(instructor, 'Shown lesson');
    await addTextItem(instructor, { title: 'Shown reading', body: 'Shown.' });
    await addModule(instructor, 'Module two');
    await addLesson(instructor, 'Later lesson');
    await addTextItem(instructor, { title: 'Later reading', body: 'Later.' });
    await publishCourse(instructor);
    await hideItem(instructor, 'lesson', 'Hidden lesson');
  });

  await test.step('a new student enrols and lands in the first shown lesson', async () => {
    await openCourse(student, course);
    const coursePage = student.url();
    await enrolAndLand(student, newUser('Sam', ['student']));
    await expect(student).toHaveURL(/\/learn\/[0-9a-f-]+\/lesson\/[0-9a-f-]+$/);
    await expect(
      student.getByRole('heading', { name: 'Shown lesson' }),
    ).toBeVisible();
    await expect(student.getByText("You're enrolled in")).toBeVisible();
    await expect(student.getByRole('dialog')).toHaveCount(0);
    await screenshot(student, 'landed-in-first-lesson');

    await student.goBack();
    await expect(student).toHaveURL(coursePage);
  });

  await test.step('opening the lesson again from the course home shows no confirmation', async () => {
    await student.getByRole('link', { name: 'Start learning' }).click();
    await expect(student).toHaveURL(/\/home$/);
    await student.getByRole('link', { name: 'Start', exact: true }).click();
    await expect(
      student.getByRole('heading', { name: 'Shown lesson' }),
    ).toBeVisible();
    await expect(student.getByText("You're enrolled in")).toHaveCount(0);
  });
});

test('enrolling in a course with no lessons lands on the course home', async ({
  browser,
}) => {
  const course = uniqueName('E2E empty course');
  const instructor = await browser.newPage();
  const student = await browser.newPage();

  await instructor.goto(`${PORTALS.instructor}/my-courses`);
  await signIn(instructor, newUser('Ivy', ['instructor']));
  await createCourse(instructor, {
    title: course,
    summary: 'A course made by the end-to-end tests.',
  });
  await addModule(instructor, 'Module one');
  await addLesson(instructor, 'Hidden lesson');
  await addTextItem(instructor, { title: 'Hidden reading', body: 'Hidden.' });
  await publishCourse(instructor);
  // A published course whose only lesson is hidden shows no lesson.
  await hideItem(instructor, 'lesson', 'Hidden lesson');

  await openCourse(student, course);
  await enrolAndLand(student, newUser('Sam', ['student']));
  await expect(student).toHaveURL(/\/learn\/[0-9a-f-]+\/home$/);
  await expect(student.getByText("You're enrolled in")).toBeVisible();
  await expect(student.getByText('No lessons yet')).toBeVisible();
  await screenshot(student, 'landed-on-course-home');
});

// The lesson is the wide column: at desktop width it is at least 1.8 times the
// outline's width, however long the module and lesson titles are.
test('the lesson column is wider than the outline', async ({ page }) => {
  const title = uniqueName('E2E wide lesson course');
  const instructor = await apiUser('Ivy', ['instructor']);
  const { lessonTitles } = await createLongTitledCourseViaApi(
    instructor,
    title,
  );

  await openCourse(page, title);
  await enrolAndLand(page, newUser('Wes', ['student']));
  await expect(
    page.getByRole('heading', { level: 2, name: lessonTitles[0] }),
  ).toBeVisible();

  const outline = await page.locator('aside').boundingBox();
  const lesson = await page.locator('main section').first().boundingBox();
  expect(outline).not.toBeNull();
  expect(lesson).not.toBeNull();
  expect(lesson?.width ?? 0).toBeGreaterThanOrEqual(
    (outline?.width ?? Number.POSITIVE_INFINITY) * 1.8,
  );
  await screenshot(page, 'lesson columns at desktop width');
});

// A request that gets no answer says so in a sentence, and "Try again" asks
// for it again without a reload.
test('a quiz that fails to load offers to try again', async ({ page }) => {
  const title = uniqueName('E2E quiz load error course');
  await createPublishedQuizCourseViaApi(
    await apiUser('Ivy', ['instructor']),
    title,
  );
  await openCourse(page, title);
  await enrol(page, newUser('Wes', ['student']));

  const fail = async (route: Route) => route.abort('connectionfailed');
  await page.route('**/quiz.view*', fail);
  await startFirstLesson(page);

  await expect(
    page.getByText(
      "Couldn't reach Discava. Check your connection and try again.",
    ),
  ).toBeVisible();
  await screenshot(page, 'quiz load error with Try again');

  await page.unroute('**/quiz.view*', fail);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: 'Start quiz' })).toBeVisible();
});
