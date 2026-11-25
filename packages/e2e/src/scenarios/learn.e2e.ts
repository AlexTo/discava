/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Route } from '@playwright/test';
import {
  apiUser,
  createLongTitledCourseViaApi,
  createPublishedCourseViaApi,
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
  lessonItem,
  lessonSteps,
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
    // Following the search result's link moved focus to the page's heading.
    await expect(student).toHaveTitle(`${course} · Discava`);
    await expect(student.getByRole('heading', { level: 1 })).toBeFocused();
    await screenshot(student, 'course page after following a link');
    await student.goBack();
    await expect(student).toHaveTitle(`Search: ${course} · Discava`);
    await student.goForward();
    await expect(student).toHaveTitle(`${course} · Discava`);
    // A screen reader in browse mode follows a link with a bare click: no
    // key or pointer press first. Focus still moves to the page's heading.
    await student.goBack();
    await expect(student).toHaveTitle(`Search: ${course} · Discava`);
    await student.getByRole('link', { name: course }).dispatchEvent('click');
    await expect(student).toHaveTitle(`${course} · Discava`);
    await expect(student.getByRole('heading', { level: 1 })).toBeFocused();
    await screenshot(student, 'course page after a screen reader click');
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
    await expect(student).toHaveTitle(`Lesson one · ${course} · Discava`);
    await screenshot(student, 'lesson page with its own title');
    await student.getByRole('button', { name: 'Mark as done' }).click();
    await expect(student.getByText('1/1 lessons complete')).toBeVisible();
    await student.goBack();
    await expect(student).toHaveTitle(`${course} · Discava`);
    await student.goForward();
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
  await screenshot(page, 'quiz load error with Try again under the message');

  await page.unroute('**/quiz.view*', fail);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: 'Start quiz' })).toBeVisible();
});

// A step's link is the lesson's address with the item's fragment, so it opens
// that item in a new tab (#756). The items appear only once the course has
// loaded, after the browser has looked for the fragment, so the lesson scrolls
// to the item itself.
test("a lesson's step links lead to their items", async ({ page }) => {
  const title = uniqueName('E2E step link course');
  const instructor = await apiUser('Ivy', ['instructor']);
  const { courseId, lessonId, texts, quiz } = await createPublishedCourseViaApi(
    instructor,
    title,
  );
  const lastId = quiz.contentItemId;
  const lastAddress = `${PORTALS.student}/learn/${courseId}/lesson/${lessonId}#item-${lastId}`;

  await openCourse(page, title);
  await enrolAndLand(page, newUser('Sid', ['student']));

  await test.step('each step links to the lesson with its item', async () => {
    const steps = lessonSteps(page);
    await expect(steps).toHaveCount(3);
    const ids = [...texts.map((t) => t.contentItemId), lastId];
    for (const [i, id] of ids.entries()) {
      await expect(steps.nth(i)).toHaveAttribute(
        'href',
        `/learn/${courseId}/lesson/${lessonId}#item-${id}`,
      );
    }
  });

  await test.step('the last step, visited directly, opens at its item', async () => {
    await page.goto(lastAddress);
    const item = page.locator(`#item-${lastId}`);
    await expect(item).toBeFocused();
    await expect(item).toBeInViewport();
    const header = await page.getByRole('banner').first().boundingBox();
    const box = await item.boundingBox();
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(
      (header?.y ?? 0) + (header?.height ?? 0) - 1,
    );
    await screenshot(page, 'lesson opened at its last step');
  });

  await test.step('clicking a step scrolls to it without changing the address', async () => {
    await page.goto(`${PORTALS.student}/learn/${courseId}/lesson/${lessonId}`);
    const first = lessonItem(page, 'Reading 1');
    await expect(first).toBeVisible();
    const before = page.url();
    await lessonSteps(page).nth(2).click();
    const item = page.locator(`#item-${lastId}`);
    await expect(item).toBeFocused();
    // The scroll is smooth: wait for the item to settle just below the
    // header, as when its address is visited directly. Merely intersecting
    // the viewport already holds before the click.
    await expect
      .poll(async () => {
        const header = await page.getByRole('banner').first().boundingBox();
        const box = await item.boundingBox();
        return (box?.y ?? Number.POSITIVE_INFINITY) - (header?.height ?? 0);
      })
      .toBeLessThanOrEqual(40);
    expect(page.url()).toBe(before);
    await screenshot(page, 'lesson after clicking a step');
  });
});
