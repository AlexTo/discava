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
  refundSession,
  sessionRefunds,
} from '../helpers/stripe-stand-in.js';
import { expect, test } from '../helpers/table-invariants.js';
import { uniqueName } from '../helpers/users.js';

// A student's refund request and an operator's refund can arrive together,
// and a student can press the button many times (#71). Either way Stripe
// refunds once, the order is refunded once and the enrolment ends once. The
// table-invariants fixture then checks the table they left behind.

// How many requests each race fires at once.
const RACERS = 5;

test.beforeEach(connectStripeStandIn);

const buy = async (label: string) => {
  const instructor = await apiUser('Ines', ['instructor']);
  const course = await createPricedCourseViaApi(instructor, uniqueName(label));
  const student = await apiStudent('Sam');
  const { sessionId } = await startCheckout(
    student.accessToken,
    course.courseId,
  );
  await pay(sessionId);
  await waitForEnrolment(student, course.courseId);
  return { instructor, course, student, sessionId };
};

const expectRefundedOnce = async ({
  course,
  student,
  sessionId,
}: Awaited<ReturnType<typeof buy>>) => {
  await waitForEnrolment(student, course.courseId, true);
  const orders = await ordersFor(student.sub, course.courseId);
  expect(orders.map(({ status }) => status)).toEqual(['refunded']);
  expect(await sessionRefunds(sessionId)).toHaveLength(1);
  const enrolment = await student.core.course.myEnrolment.query({
    courseId: course.courseId,
  });
  expect(enrolment?.status).toBe('dropped');
  // The notification is made from the order's change, so a repeat is a
  // duplicate; it trails the refund by the stream and the router.
  await expect
    .poll(
      async () =>
        (await student.core.notification.list.query({})).items.filter(
          ({ type }) => type === 'order.refunded',
        ).length,
      { timeout: 30_000 },
    )
    .toBe(1);
};

test('requesting a refund many times at once refunds once', async () => {
  const bought = await buy('Refund race');
  const { course, student } = bought;

  const results = await Promise.allSettled(
    Array.from({ length: RACERS }, () =>
      student.core.payment.requestRefund.mutate({ courseId: course.courseId }),
    ),
  );

  expect(results.some(({ status }) => status === 'fulfilled')).toBe(true);
  await expectRefundedOnce(bought);
  await bought.instructor.instructor.course.archive.mutate({
    courseId: course.courseId,
  });
});

test('requesting a refund while an operator refunds in full refunds once', async () => {
  const bought = await buy('Refund and operator');
  const { course, student, sessionId } = bought;

  await Promise.allSettled([
    student.core.payment.requestRefund.mutate({ courseId: course.courseId }),
    refundSession(sessionId),
  ]);

  await expectRefundedOnce(bought);
  await bought.instructor.instructor.course.archive.mutate({
    courseId: course.courseId,
  });
});
