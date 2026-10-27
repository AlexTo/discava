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
import {
  enrol,
  expectCourseCompleted,
  openCourse,
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
