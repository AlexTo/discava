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

// A student who bought a course asks for their money back from its page. The
// request goes to Stripe; the enrolment ends when Stripe's signed notice
// arrives, and the page moves to the ended state on its own.
test('a student requests a refund and the enrolment ends', async ({
  browser,
}) => {
  const title = uniqueName('E2E refundable course');
  await connectLocalStripe();

  await test.step('an instructor publishes a course priced at 19.99', async () => {
    const instructor = await browser.newPage();
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Rae', ['instructor']));
    await createCourse(instructor, {
      title,
      summary: 'A course refunded by the end-to-end tests.',
    });
    await instructor.getByLabel('Price', { exact: true }).fill('19.99');
    await instructor.getByRole('button', { name: 'Save price' }).click();
    await expect(instructor.getByText('Saved', { exact: true })).toBeVisible();
    await addModule(instructor, 'Module one');
    await addLesson(instructor, 'Lesson one');
    await addTextItem(instructor, { title: 'Reading one', body: 'Refund.' });
    await publishCourse(instructor);
  });

  const student = await browser.newPage();

  await test.step('a visitor sees the refund terms beside the price', async () => {
    await openCourse(student, title);
    await expect(student.getByText('$19.99').first()).toBeVisible();
    await expect(
      student.getByText("14-day refund if you haven't completed the course."),
    ).toBeVisible();
    await screenshot(student, 'refund-terms-beside-the-price');
  });

  await test.step('the student buys the course', async () => {
    await student.getByRole('button', { name: 'Sign in to buy' }).click();
    await student
      .getByRole('dialog', { name: 'Sign in to buy' })
      .getByRole('link', { name: 'Continue to sign in' })
      .click();
    await signIn(student, newUser('Ari', ['student']));
    await student.getByRole('button', { name: 'Buy now' }).click();
    await student.waitForURL(/\/stripe\/pay\//);
    await student.getByRole('button', { name: 'Pay', exact: true }).click();
    await student.waitForURL(
      /\/learn\/[0-9a-f-]+\/(lesson\/[0-9a-f-]+|home)$/,
      { timeout: 30_000 },
    );
  });

  await test.step('the course page offers a refund and asks before requesting it', async () => {
    await openCourse(student, title);
    await expect(
      student.getByText(/You can request a refund until/),
    ).toBeVisible();
    await screenshot(student, 'refund-offered-on-the-course-page');
    await student.getByRole('button', { name: 'Request a refund' }).click();
    const dialog = student.getByRole('dialog', { name: 'Request a refund' });
    await expect(dialog).toContainText('$19.99');
    await screenshot(student, 'refund-confirmation-dialog');
    await dialog.getByRole('button', { name: 'Request refund' }).click();
    await expect(student.getByText(/Refund requested on/)).toBeVisible();
    await expect(
      student.getByRole('button', { name: 'Request a refund' }),
    ).toHaveCount(0);
    await screenshot(student, 'refund-requested');
  });

  await test.step('the enrolment ends once the refund is confirmed', async () => {
    await expect(student.getByText(/Your enrolment has ended\./)).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      student.getByRole('button', { name: 'Buy now' }),
    ).toBeVisible();
    await screenshot(student, 'enrolment-ended-after-refund-request');
  });
});
