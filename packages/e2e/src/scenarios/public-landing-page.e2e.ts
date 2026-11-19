/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { apiUser, createPublishedCourseViaApi } from '../helpers/api.js';
import {
  addLesson,
  addModule,
  addTextItem,
  createCourse,
  publishCourse,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { coursePageUrl } from '../helpers/public-pages.js';
import { screenshot } from '../helpers/screenshots.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// The instructor writes the landing page in the portal; the public page then
// shows what a visitor needs to decide: outcomes, requirements and who teaches.
test('an instructor edits the landing page and a signed-out visitor sees it', async ({
  browser,
}) => {
  const title = uniqueName('E2E landing course');
  const instructor = await browser.newPage();
  const visitor = await browser.newPage();

  await test.step('the instructor publishes a course', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Ivy', ['instructor']));
    await createCourse(instructor, {
      title,
      summary: 'A course for the landing page tests.',
    });
    await addModule(instructor, 'Module one');
    await addLesson(instructor, 'Lesson one');
    await addTextItem(instructor, { title: 'Reading one', body: 'Hello.' });
    await publishCourse(instructor);
  });

  await test.step('the card saves outcomes and requirements, and the checklist follows', async () => {
    const checklist = instructor.getByRole('region', {
      name: 'Landing page checklist',
    });
    await expect(
      checklist.getByRole('listitem').filter({ hasText: 'Learning outcomes' }),
    ).toContainText('Not yet');

    const outcomes = 'What students will learn';
    await instructor
      .getByRole('button', { name: `Add ${outcomes} item` })
      .click();
    await instructor
      .getByLabel(`${outcomes} item 1`)
      .fill('Build a landing page');
    await instructor
      .getByRole('button', { name: `Add ${outcomes} item` })
      .click();
    await instructor.getByLabel(`${outcomes} item 2`).fill('Read a curriculum');
    await instructor
      .getByRole('button', { name: 'Move up What students will learn item 2' })
      .click();
    await instructor
      .getByRole('button', { name: 'Add Requirements item' })
      .click();
    await instructor.getByLabel('Requirements item 1').fill('A laptop');
    await instructor.getByRole('button', { name: 'Save landing page' }).click();
    await expect(instructor.getByText('Saved', { exact: true })).toBeVisible();

    await expect(
      checklist.getByRole('listitem').filter({ hasText: 'Learning outcomes' }),
    ).toContainText('Done');
    await expect(
      instructor.getByRole('link', { name: 'View public page' }),
    ).toBeVisible();
    await screenshot(instructor, 'landing page card and checklist', {
      fullPage: true,
    });
  });

  await test.step('signed out, the sections show in the order the instructor set', async () => {
    const courseId = instructor.url().split('/').pop() as string;
    await visitor.goto(coursePageUrl(courseId));
    await expect(
      visitor.getByRole('heading', { level: 1, name: title }),
    ).toBeVisible();
    const learn = visitor.getByRole('region', { name: "What you'll learn" });
    await expect(learn.getByRole('listitem')).toHaveText([
      'Read a curriculum',
      'Build a landing page',
    ]);
    await expect(
      visitor
        .getByRole('region', { name: 'Requirements' })
        .getByText('A laptop'),
    ).toBeVisible();
    await expect(
      visitor
        .getByRole('region', { name: 'Instructors' })
        .getByText('View profile'),
    ).toBeVisible();
    await screenshot(visitor, 'landing page with outcomes and instructor', {
      fullPage: true,
    });
  });
});

// A course that is archived is not found for anyone, including a student who
// enrolled.
test('an archived course is not found for a visitor or an enrolled student', async ({
  page,
}) => {
  const instructor = await apiUser('Ivy', ['instructor']);
  const { courseId } = await createPublishedCourseViaApi(
    instructor,
    uniqueName('E2E archived landing course'),
  );
  const student = await apiUser('Sam', ['student']);
  await student.core.course.enrol.mutate({ courseId });
  await instructor.instructor.course.archive.mutate({ courseId });

  await page.goto(coursePageUrl(courseId));
  await expect(
    page.getByRole('heading', { name: 'Course not found' }),
  ).toBeVisible();
  await screenshot(page, 'archived course not found');

  // An enrolled student gets the same answer from the API.
  await expect(
    student.core.course.publicView.query({ courseId }),
  ).rejects.toMatchObject({ data: { code: 'NOT_FOUND' } });
});
