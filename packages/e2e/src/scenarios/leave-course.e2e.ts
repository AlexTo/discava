/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { createPublishedCourse } from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { enrolAndLand, openCourse } from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// A student enrolled in a free course leaves it from the course page. The
// enrolment ends, and enrolling again brings it back.
test('a student leaves a free course and enrols again', async ({ browser }) => {
  const title = uniqueName('E2E leavable course');

  await test.step('an instructor publishes a free course', async () => {
    const instructor = await browser.newPage();
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Lena', ['instructor']));
    await createPublishedCourse(instructor, {
      title,
      readings: ['Reading one'],
    });
  });

  const student = await browser.newPage();

  await test.step('the student enrols', async () => {
    await openCourse(student, title);
    await enrolAndLand(student, newUser('Ben', ['student']));
    await openCourse(student, title);
    await expect(
      student.getByRole('button', { name: 'Leave course' }),
    ).toBeVisible();
    await screenshot(student, 'leave-offered-on-the-course-page');
  });

  await test.step("a course page opened at a section's address starts there", async () => {
    const fresh = await student.context().newPage();
    await fresh.goto(`${student.url().split('#')[0]}#modules`);
    const modules = fresh.locator('#modules');
    await expect(modules).toBeFocused();
    await expect(modules).toBeInViewport();
    await screenshot(fresh, 'course-page-opened-at-modules');
    await fresh.close();
  });

  await test.step('leaving asks first, then ends the enrolment', async () => {
    await student.getByRole('button', { name: 'Leave course' }).click();
    const dialog = student.getByRole('dialog', { name: 'Leave course' });
    await expect(dialog).toContainText('Your progress is kept');
    await screenshot(student, 'leave-confirmation-dialog');
    await dialog.getByRole('button', { name: 'Leave course' }).click();
    await expect(student.getByText('Your enrolment has ended.')).toBeVisible();
    await expect(
      student.getByRole('button', { name: 'Enrol now' }),
    ).toBeVisible();
    await screenshot(student, 'enrolment-ended-after-leaving');
  });

  await test.step('enrolling again restores the enrolment', async () => {
    await student.getByRole('button', { name: 'Enrol now' }).click();
    await student.waitForURL(/\/learn\/[0-9a-f-]+\/(lesson\/[0-9a-f-]+|home)$/);
    await openCourse(student, title);
    await expect(
      student.getByRole('button', { name: 'Leave course' }),
    ).toBeVisible();
  });
});
