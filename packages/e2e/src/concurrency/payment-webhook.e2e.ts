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
import {
  connectStripeStandIn,
  replayEvent,
  sessionRefunds,
} from '../helpers/stripe-stand-in.js';
import { expect, test } from '../helpers/table-invariants.js';
import { uniqueName } from '../helpers/users.js';

// Stripe delivers an event more than once, and two tabs can open two checkouts
// (#71). However many deliveries land at the same moment, the student pays
// once and is enrolled once. The table-invariants fixture then checks the
// table they left behind.

// How many deliveries each race fires at once.
const RACERS = 10;

test.beforeEach(connectStripeStandIn);

test('replaying the confirmation many times at once enrols once', async () => {
  const instructor = await apiUser('Ines', ['instructor']);
  const course = await createPricedCourseViaApi(
    instructor,
    uniqueName('Webhook race'),
  );
  const student = await apiStudent('Sam');
  const { sessionId } = await startCheckout(
    student.accessToken,
    course.courseId,
  );

  await pay(sessionId);
  await waitForEnrolment(student, course.courseId);
  const { delivered } = await replayEvent(sessionId, RACERS);

  expect(delivered).toHaveLength(RACERS);
  expect(delivered.every((status) => status === 200)).toBe(true);
  const orders = await ordersFor(student.sub, course.courseId);
  expect(orders.map(({ status }) => status)).toEqual(['paid']);
  const enrolment = await student.core.course.myEnrolment.query({
    courseId: course.courseId,
  });
  expect(enrolment?.status).not.toBe('dropped');
  expect(await sessionRefunds(sessionId)).toEqual([]);

  await instructor.instructor.course.archive.mutate({
    courseId: course.courseId,
  });
});

test('two checkouts for one student and course, both paid, enrol once and refund the second', async () => {
  const instructor = await apiUser('Ines', ['instructor']);
  const course = await createPricedCourseViaApi(
    instructor,
    uniqueName('Double payment'),
  );
  const student = await apiStudent('Sam');

  // Two tabs press Buy now together. Neither order has a session yet, so
  // neither finds the other's to reuse and each opens its own.
  const sessions = await Promise.all([
    startCheckout(student.accessToken, course.courseId),
    startCheckout(student.accessToken, course.courseId),
  ]);
  const sessionIds = [...new Set(sessions.map(({ sessionId }) => sessionId))];
  expect(sessionIds).toHaveLength(2);

  // Both are paid at the same moment.
  await Promise.all(sessionIds.map(pay));
  await waitForEnrolment(student, course.courseId);

  await expect
    .poll(
      async () =>
        (await ordersFor(student.sub, course.courseId))
          .map(({ status, refundReason }) => `${status}:${refundReason ?? ''}`)
          .sort(),
      { timeout: 30_000 },
    )
    .toEqual(['paid:', 'refunded:duplicate']);
  const refunds = await Promise.all(sessionIds.map(sessionRefunds));
  expect(refunds.map((each) => each.length).sort()).toEqual([0, 1]);

  await instructor.instructor.course.archive.mutate({
    courseId: course.courseId,
  });
});
