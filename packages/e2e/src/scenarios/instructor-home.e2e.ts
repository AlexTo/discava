/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { apiUser } from '../helpers/api.js';
import {
  apiUserFor,
  createUploadAssignmentCourse,
  returnSubmission,
  uploadSubmissionFile,
} from '../helpers/assignment.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// Sample content a real instructor's home page must never show.
const SAMPLE_STRINGS = [
  'Applied Mathematics',
  'Foundations of Biology',
  'Academic Communication',
  'Mia Chen',
  'Oliver Smith',
  '33 submissions',
  'Needs attention',
  'Recent activity',
  'Upcoming',
  'Open grading queue',
  'Create an assignment',
];

// The instructor home page lists the signed-in instructor's own courses: a
// new instructor starts with none, and a course they create shows up there.
test('a new instructor sees their real courses on the home page', async ({
  page,
}) => {
  const course = uniqueName('E2E home course');

  await test.step('a new instructor sees the empty state and nothing invented', async () => {
    await page.goto(`${PORTALS.instructor}/`);
    await signIn(page, newUser('Hana', ['instructor']));
    await expect(
      page.getByText("You don't teach any courses yet"),
    ).toBeVisible();
    for (const sample of SAMPLE_STRINGS) {
      await expect(page.getByText(sample)).toHaveCount(0);
    }
  });

  await test.step('a course created from the home page is listed when they return', async () => {
    await page.getByRole('button', { name: 'Create a course' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Create a course' });
    await dialog.getByLabel('Course title').fill(course);
    await dialog
      .getByLabel('Course summary')
      .fill('A course the home page end-to-end test creates.');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await page.waitForURL(/\/my-courses\/[0-9a-f-]+$/);
    await expect(
      page.getByRole('heading', { level: 1, name: course }),
    ).toBeVisible();

    await page.goto(`${PORTALS.instructor}/`);
    await expect(
      page.getByRole('link', { name: new RegExp(course) }),
    ).toBeVisible();
    await expect(page.getByText("You don't teach any courses yet")).toHaveCount(
      0,
    );
  });

  await test.step('opening it from its card loads the editor', async () => {
    await page.getByRole('link', { name: new RegExp(course) }).click();
    await page.waitForURL(/\/my-courses\/[0-9a-f-]+$/);
    await expect(
      page.getByRole('heading', { level: 1, name: course }),
    ).toBeVisible();
    await expect(page.getByText("You don't have permission")).toHaveCount(0);
  });

  await test.step('My Courses counts their real courses and invents no figures', async () => {
    await page.goto(`${PORTALS.instructor}/my-courses`);
    const summary = page.getByLabel('Course summary');
    await expect(
      summary.locator('[data-slot="card"]', { hasText: 'Draft courses' }),
    ).toContainText('1');
    await expect(
      summary.locator('[data-slot="card"]', { hasText: 'Active courses' }),
    ).toContainText('0');
    await expect(page.getByText(course)).toBeVisible();
    for (const invented of [
      'Semester 2, 2026',
      'Course content coming soon',
      'Updated recently',
      'Awaiting grading',
    ]) {
      await expect(page.getByText(invented)).toHaveCount(0);
    }
    await screenshot(page, 'my courses with real figures');
  });
});

// Waiting work from every course the instructor teaches is queued on the home
// page, oldest first, and leaves it once returned (#102).
test('the home page queues work waiting for grading across courses', async ({
  page,
}) => {
  const ivy = newUser('Ivy', ['instructor']);
  const instructor = await apiUserFor(ivy);
  const tess = await apiUser('Tess', ['student']);
  const sam = await apiUser('Sam', ['student']);
  const first = await createUploadAssignmentCourse(instructor, {
    courseTitle: uniqueName('E2E queue course A'),
    assignmentTitle: 'Essay',
  });
  const second = await createUploadAssignmentCourse(instructor, {
    courseTitle: uniqueName('E2E queue course B'),
    assignmentTitle: 'Report',
  });
  // Tess submits to the first course before Sam does to the second.
  await tess.core.course.enrol.mutate({ courseId: first.courseId });
  await tess.core.assignment.submit.mutate(
    await uploadSubmissionFile(tess, first, 'a.txt', Buffer.from('a')),
  );
  await sam.core.course.enrol.mutate({ courseId: second.courseId });
  await sam.core.assignment.submit.mutate(
    await uploadSubmissionFile(sam, second, 'b.txt', Buffer.from('b')),
  );

  await page.goto(`${PORTALS.instructor}/`);
  await signIn(page, ivy);
  const queue = page.getByRole('region', { name: 'Waiting for grading' });

  await test.step('both are listed oldest first with the total', async () => {
    await expect(queue.getByRole('link')).toHaveText([/Tess/, /Sam/]);
    await expect(queue.getByText('2', { exact: true })).toBeVisible();
    for (const sample of SAMPLE_STRINGS) {
      await expect(page.getByText(sample)).toHaveCount(0);
    }
    await screenshot(page, 'grading queue on the home page');
  });

  await test.step('an entry opens its review page, and returning it empties its place', async () => {
    await queue.getByRole('link', { name: /Tess/ }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: /Tess/ }),
    ).toBeVisible();
    await returnSubmission(page, 5, 'Fine');

    await page.goto(`${PORTALS.instructor}/`);
    await expect(queue.getByRole('link')).toHaveText([/Sam/]);
    await expect(queue.getByRole('link', { name: /Tess/ })).toHaveCount(0);
    await screenshot(page, 'grading queue after returning one');
  });
});
