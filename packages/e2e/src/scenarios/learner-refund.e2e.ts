/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Page } from '@playwright/test';
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
import {
  failNextRefund,
  holdNextRefund,
  sessionIdOf,
} from '../helpers/stripe-stand-in.js';
import {
  markItemDone,
  openCourse,
  startFirstLesson,
} from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

const TERMS =
  "14-day refund while you've completed less than half of the course. One refund per course.";

// Buys the open course as the signed-in student and lands in it.
const buy = async (student: Page) => {
  await student.getByRole('button', { name: 'Buy now' }).click();
  await student.waitForURL(/\/stripe\/pay\//);
  await student.getByRole('button', { name: 'Pay', exact: true }).click();
  await student.waitForURL(/\/learn\/[0-9a-f-]+\/(lesson\/[0-9a-f-]+|home)$/, {
    timeout: 30_000,
  });
};

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
    await expect(student.getByText(TERMS)).toBeVisible();
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

// A refund is refused once half the course is done, and once a student has
// been refunded for the course at their own request.
test('refund limits: half the course, once per course', async ({ browser }) => {
  const title = uniqueName('E2E refund limits course');
  await connectLocalStripe();

  await test.step('an instructor publishes a four-item course priced at 19.99', async () => {
    const instructor = await browser.newPage();
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Rae', ['instructor']));
    await createCourse(instructor, {
      title,
      summary: 'A course whose refunds are limited.',
    });
    await instructor.getByLabel('Price', { exact: true }).fill('19.99');
    await instructor.getByRole('button', { name: 'Save price' }).click();
    await expect(instructor.getByText('Saved', { exact: true })).toBeVisible();
    await addModule(instructor, 'Module one');
    await addLesson(instructor, 'Lesson one');
    for (const name of ['One', 'Two', 'Three', 'Four']) {
      await addTextItem(instructor, {
        title: `Reading ${name}`,
        body: name,
      });
    }
    await publishCourse(instructor);
  });

  const half = await browser.newPage();
  await test.step('a student who completes half of the course is refused', async () => {
    await openCourse(half, title);
    await expect(half.getByText(TERMS)).toBeVisible();
    await screenshot(half, 'refund-limits-terms-signed-out');
    await half.getByRole('button', { name: 'Sign in to buy' }).click();
    await half
      .getByRole('dialog', { name: 'Sign in to buy' })
      .getByRole('link', { name: 'Continue to sign in' })
      .click();
    await signIn(half, newUser('Hal', ['student']));
    await buy(half);
    await half.goto(half.url().replace(/\/(lesson\/.*|home)$/, '/home'));
    await startFirstLesson(half);
    const lesson = half.url();
    await markItemDone(half, 'Reading One');
    await markItemDone(half, 'Reading Two');
    await half.goto(lesson.replace(/\/lesson\/.*$/, ''));
    await expect(
      half.getByText("Refunds end once you've completed half of the course."),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      half.getByRole('button', { name: 'Request a refund' }),
    ).toHaveCount(0);
    await screenshot(half, 'refund-refused-at-half-the-course');
  });

  const quarter = await browser.newPage();
  await test.step('a student at a quarter is refunded, warned, buys again and is not offered a refund', async () => {
    await openCourse(quarter, title);
    await quarter.getByRole('button', { name: 'Sign in to buy' }).click();
    await quarter
      .getByRole('dialog', { name: 'Sign in to buy' })
      .getByRole('link', { name: 'Continue to sign in' })
      .click();
    await signIn(quarter, newUser('Quin', ['student']));
    await buy(quarter);
    await quarter.goto(quarter.url().replace(/\/(lesson\/.*|home)$/, '/home'));
    await startFirstLesson(quarter);
    await markItemDone(quarter, 'Reading One');
    await openCourse(quarter, title);
    await quarter.getByRole('button', { name: 'Request a refund' }).click();
    await quarter
      .getByRole('dialog', { name: 'Request a refund' })
      .getByRole('button', { name: 'Request refund' })
      .click();
    await expect(quarter.getByText(/Your enrolment has ended\./)).toBeVisible({
      timeout: 30_000,
    });
    const warning = quarter.getByText(
      "You were refunded for this course before. If you buy it again, it can't be refunded.",
    );
    await expect(warning).toBeVisible();
    await screenshot(quarter, 'refunded-before-warning-beside-buy-now');

    await buy(quarter);
    await openCourse(quarter, title);
    await expect(
      quarter.getByText(
        "You were refunded for this course before, so this purchase can't be refunded.",
      ),
    ).toBeVisible();
    await expect(
      quarter.getByRole('button', { name: 'Request a refund' }),
    ).toHaveCount(0);
    await screenshot(quarter, 'second-purchase-offered-no-refund');
  });
});

// Stripe can accept a refund and report later that it failed. The order stays
// paid, the enrolment stays, and the page says so instead of waiting.
test('a failed refund is shown to the student', async ({ browser }) => {
  const title = uniqueName('E2E failed refund course');
  await connectLocalStripe();

  await test.step('an instructor publishes a course priced at 19.99', async () => {
    const instructor = await browser.newPage();
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Rae', ['instructor']));
    await createCourse(instructor, {
      title,
      summary: 'A course whose refund fails.',
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
  let sessionId = '';
  await test.step('a student buys the course', async () => {
    await openCourse(student, title);
    await student.getByRole('button', { name: 'Sign in to buy' }).click();
    await student
      .getByRole('dialog', { name: 'Sign in to buy' })
      .getByRole('link', { name: 'Continue to sign in' })
      .click();
    await signIn(student, newUser('Fay', ['student']));
    await student.getByRole('button', { name: 'Buy now' }).click();
    await student.waitForURL(/\/stripe\/pay\//);
    sessionId = sessionIdOf(student.url());
    await student.getByRole('button', { name: 'Pay', exact: true }).click();
    await student.waitForURL(
      /\/learn\/[0-9a-f-]+\/(lesson\/[0-9a-f-]+|home)$/,
      { timeout: 30_000 },
    );
  });

  await test.step('the refund fails, and the page says so and keeps the access', async () => {
    await failNextRefund(sessionId);
    await openCourse(student, title);
    await student.getByRole('button', { name: 'Request a refund' }).click();
    await student
      .getByRole('dialog', { name: 'Request a refund' })
      .getByRole('button', { name: 'Request refund' })
      .click();
    await expect(student.getByText('Your refund failed')).toBeVisible({
      timeout: 30_000,
    });
    await expect(student.getByText(/contact support/)).toBeVisible();
    await expect(student.getByText(/Refund requested on/)).toHaveCount(0);
    await expect(
      student.getByRole('button', { name: 'Request a refund' }),
    ).toHaveCount(0);
    await screenshot(student, 'refund-failed');
  });
});

// A refund that Stripe never settles must not poll for ever: after the limit
// the page says it is still being processed and offers to check again. The
// browser's clock is faked so the two minutes pass at once.
test('a pending refund stops polling and offers to check again', async ({
  browser,
}) => {
  const title = uniqueName('E2E pending refund course');
  await connectLocalStripe();

  await test.step('an instructor publishes a course priced at 19.99', async () => {
    const instructor = await browser.newPage();
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Rae', ['instructor']));
    await createCourse(instructor, {
      title,
      summary: 'A course whose refund stays pending.',
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
  let sessionId = '';
  await test.step('a student buys the course', async () => {
    await openCourse(student, title);
    await student.getByRole('button', { name: 'Sign in to buy' }).click();
    await student
      .getByRole('dialog', { name: 'Sign in to buy' })
      .getByRole('link', { name: 'Continue to sign in' })
      .click();
    await signIn(student, newUser('Pia', ['student']));
    await student.getByRole('button', { name: 'Buy now' }).click();
    await student.waitForURL(/\/stripe\/pay\//);
    sessionId = sessionIdOf(student.url());
    await student.getByRole('button', { name: 'Pay', exact: true }).click();
    await student.waitForURL(
      /\/learn\/[0-9a-f-]+\/(lesson\/[0-9a-f-]+|home)$/,
      { timeout: 30_000 },
    );
  });

  await test.step('the refund stays pending, then the page stops waiting', async () => {
    await holdNextRefund(sessionId);
    // Installed before the course page loads, so its timers are the fake ones;
    // time still runs until the clock is moved.
    await student.clock.install();
    await openCourse(student, title);
    await student.getByRole('button', { name: 'Request a refund' }).click();
    await student
      .getByRole('dialog', { name: 'Request a refund' })
      .getByRole('button', { name: 'Request refund' })
      .click();
    await expect(student.getByText(/Refund requested on/)).toBeVisible();
    await expect(
      student.getByText('Still being processed', { exact: true }),
    ).toHaveCount(0);
    await student.clock.fastForward(125_000);
    await expect(
      student.getByText('Still being processed', { exact: true }),
    ).toBeVisible();
    await expect(
      student.getByRole('button', { name: 'Check again' }),
    ).toBeVisible();
    await screenshot(student, 'refund-still-being-processed');
  });

  await test.step('checking again polls for another round', async () => {
    await student.getByRole('button', { name: 'Check again' }).click();
    await expect(
      student.getByText('Still being processed', { exact: true }),
    ).toHaveCount(0);
    await expect(student.getByText(/Refund requested on/)).toBeVisible();
  });
});
