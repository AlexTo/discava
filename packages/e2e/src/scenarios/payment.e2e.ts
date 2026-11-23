/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { apiUser } from '../helpers/api.js';
import {
  apiStudent,
  createPricedCourseViaApi,
  ordersFor,
  pay,
  startCheckout,
  waitForEnrolment,
} from '../helpers/payment.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import {
  connectStripeStandIn,
  sessionIdOf,
} from '../helpers/stripe-stand-in.js';
import { openCourse } from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// Buying a priced course on the stand-in's hosted page, and what must not
// grant access: the free route, a forged return, a payment that never came.
test.beforeEach(connectStripeStandIn);

test('a student buys a priced course, declines, cancels and pays', async ({
  browser,
}) => {
  const title = uniqueName('E2E bought course');
  const instructor = await apiUser('Ines', ['instructor']);
  const course = await createPricedCourseViaApi(instructor, title);
  const page = await browser.newPage();
  let payUrl = '';

  await test.step('the student starts a checkout and declines the card', async () => {
    await openCourse(page, title);
    await page.getByRole('button', { name: 'Sign in to buy' }).click();
    await page
      .getByRole('dialog', { name: 'Sign in to buy' })
      .getByRole('link', { name: 'Continue to sign in' })
      .click();
    await signIn(page, newUser('Sam', ['student']));
    await page.getByRole('button', { name: 'Buy now' }).click();
    await page.waitForURL(/\/stripe\/pay\//);
    payUrl = page.url();
    await page.getByRole('button', { name: 'Decline card' }).click();
    await expect(page.getByText('Your card was declined.')).toBeVisible();
    await screenshot(page, 'card-declined');
  });

  await test.step('cancelling returns to the course with the cancelled message', async () => {
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForURL(/checkout=cancelled/);
    await expect(
      page.getByText('Payment cancelled. You have not been charged.'),
    ).toBeVisible();
    await screenshot(page, 'payment-cancelled');
  });

  await test.step('Buy now again reuses the same payment page', async () => {
    await page.getByRole('button', { name: 'Buy now' }).click();
    await page.waitForURL(/\/stripe\/pay\//);
    expect(page.url()).toBe(payUrl);
  });

  await test.step('paying enrols the student once', async () => {
    await page.getByRole('button', { name: 'Pay', exact: true }).click();
    await page.waitForURL(/\/learn\/[0-9a-f-]+\/(lesson\/[0-9a-f-]+|home)$/, {
      timeout: 30_000,
    });
    await expect(page.getByText("You're enrolled in")).toBeVisible();
    await screenshot(page, 'enrolled-after-payment');
  });

  await instructor.instructor.course.archive.mutate({
    courseId: course.courseId,
  });
});

test('the free route and a forged return grant nothing', async ({
  browser,
}) => {
  const instructor = await apiUser('Ines', ['instructor']);
  const course = await createPricedCourseViaApi(
    instructor,
    uniqueName('E2E guarded course'),
  );
  const student = await apiStudent('Fay');

  await test.step('enrolling for free is refused for a priced course', async () => {
    await expect(
      student.core.course.enrol.mutate({ courseId: course.courseId }),
    ).rejects.toBeTruthy();
    expect(
      await student.core.course.myEnrolment.query({
        courseId: course.courseId,
      }),
    ).toBeNull();
  });

  await test.step('a return that says success, with no payment, enrols no one', async () => {
    const page = await browser.newPage();
    await page.goto(
      `${PORTALS.student}/learn/${course.courseId}?checkout=success`,
    );
    await signIn(page, newUser('Gus', ['student']));
    await page.waitForURL(/checkout=success/);
    await expect(page.getByText("You're enrolled in")).toHaveCount(0);
    await expect(
      page.getByText(/Confirming your payment|Buy now/).first(),
    ).toBeVisible();
    await screenshot(page, 'forged-return');
  });

  await instructor.instructor.course.archive.mutate({
    courseId: course.courseId,
  });
});

test('pricing a course keeps a free enrolment and makes a newcomer pay', async () => {
  const instructor = await apiUser('Ines', ['instructor']);
  const course = await createPricedCourseViaApi(
    instructor,
    uniqueName('E2E free then priced'),
    0,
  );
  const early = await apiStudent('Ed');
  const late = await apiStudent('Lou');

  await early.core.course.enrol.mutate({ courseId: course.courseId });
  await instructor.instructor.course.setPrice.mutate({
    courseId: course.courseId,
    priceAmount: 1999,
    priceCurrency: 'USD',
  });

  expect(
    (await early.core.course.myEnrolment.query({ courseId: course.courseId }))
      ?.status,
  ).not.toBe('dropped');
  await expect(
    late.core.course.enrol.mutate({ courseId: course.courseId }),
  ).rejects.toBeTruthy();
  const { sessionId, checkoutUrl } = await startCheckout(
    late.accessToken,
    course.courseId,
  );
  expect(sessionIdOf(checkoutUrl)).toBe(sessionId);
  await pay(sessionId);
  await waitForEnrolment(late, course.courseId);
  expect(
    (await ordersFor(late.sub, course.courseId)).map(({ status }) => status),
  ).toEqual(['paid']);
  expect(await ordersFor(early.sub, course.courseId)).toEqual([]);

  await instructor.instructor.course.archive.mutate({
    courseId: course.courseId,
  });
});
