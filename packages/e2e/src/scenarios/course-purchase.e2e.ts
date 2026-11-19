/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { connectLocalStripe } from '../helpers/api.js';
import {
  addLesson,
  addModule,
  addTextItem,
  createCourse,
  publishCourse,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { openCourse } from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// A student buys a priced course on the local Stripe stand-in's hosted page
// and starts learning, without reloading the course page: it waits for the
// enrolment the signed webhook creates.
test('a student buys a paid course and starts learning', async ({
  browser,
}) => {
  const title = uniqueName('E2E paid course');
  await connectLocalStripe();

  await test.step('an instructor publishes a course priced at 19.99', async () => {
    const instructor = await browser.newPage();
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Pia', ['instructor']));
    await createCourse(instructor, {
      title,
      summary: 'A course bought by the end-to-end tests.',
    });
    await instructor.getByLabel('Price', { exact: true }).fill('19.99');
    await instructor.getByRole('button', { name: 'Save price' }).click();
    await expect(instructor.getByText('Saved', { exact: true })).toBeVisible();
    await addModule(instructor, 'Module one');
    await addLesson(instructor, 'Lesson one');
    await addTextItem(instructor, { title: 'Reading one', body: 'Paid.' });
    await publishCourse(instructor);
  });

  const student = await browser.newPage();

  await test.step('a visitor sees the price and is asked to sign in to buy', async () => {
    await openCourse(student, title);
    await expect(student.getByText('$19.99').first()).toBeVisible();
    await expect(
      student.getByRole('button', { name: 'Enrol now' }),
    ).toHaveCount(0);
    await screenshot(student, 'course-page-signed-out');
    await student.getByRole('button', { name: 'Sign in to buy' }).click();
    await student
      .getByRole('dialog', { name: 'Sign in to buy' })
      .getByRole('link', { name: 'Continue to sign in' })
      .click();
    await signIn(student, newUser('Sam', ['student']));
    await expect(
      student.getByRole('button', { name: 'Buy now' }),
    ).toBeVisible();
    await screenshot(student, 'course-page-buy-now');
  });

  await test.step('the student pays on the hosted page and is enrolled', async () => {
    await student.getByRole('button', { name: 'Buy now' }).click();
    await student.waitForURL(/\/stripe\/pay\//);
    await screenshot(student, 'hosted-payment-page');
    await student.getByRole('button', { name: 'Pay', exact: true }).click();
    await student.waitForURL(/checkout=success/);
    // The webhook usually lands before the redirect does, so the page loads
    // already enrolled; when it lands later, the page waits and opens the
    // enrolled dialog. Either way the student can start learning.
    await expect(student.getByText('Enrolled', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await screenshot(student, 'enrolled-after-payment');
    await student.getByRole('link', { name: 'Start learning' }).click();
    await student.waitForURL(/\/learn\/[0-9a-f-]+\/home$/);
  });
});
