/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { apiUser } from '../helpers/api.js';
import {
  apiStudent,
  createPricedCourseViaApi,
  pay,
  startCheckout,
  waitForEnrolment,
} from '../helpers/payment.js';
import {
  connectStripeStandIn,
  refundSession,
} from '../helpers/stripe-stand-in.js';
import { expect, test } from '../helpers/table-invariants.js';
import { uniqueName } from '../helpers/users.js';

// An operator's refund in the Stripe dashboard ends the enrolment but not the
// record of the course: the completion and the certificate stay, and buying
// again brings the progress back.
test.beforeEach(connectStripeStandIn);

const buy = async (
  student: Awaited<ReturnType<typeof apiStudent>>,
  courseId: string,
) => {
  const { sessionId } = await startCheckout(student.accessToken, courseId);
  await pay(sessionId);
  await waitForEnrolment(student, courseId);
  return sessionId;
};

test('a full refund ends the enrolment, keeps the record, and buying again restores it', async () => {
  const instructor = await apiUser('Ines', ['instructor']);
  const course = await createPricedCourseViaApi(
    instructor,
    uniqueName('E2E refunded course'),
  );
  const student = await apiStudent('Sam');
  const first = await buy(student, course.courseId);

  await student.core.contentItem.complete.mutate(course.reading);
  await expect
    .poll(
      async () =>
        (await student.core.certificate.myCertificates.query()).length,
      {
        timeout: 30_000,
      },
    )
    .toBe(1);
  const [{ certificateId }] =
    await student.core.certificate.myCertificates.query();

  await refundSession(first);
  await waitForEnrolment(student, course.courseId, true);
  const verified = await student.core.certificate.verify.query({
    certificateId,
  });
  expect(verified.status).toBe('valid');
  expect(
    (await student.core.course.myEnrolment.query({ courseId: course.courseId }))
      ?.completedAt,
  ).toBeTruthy();

  await buy(student, course.courseId);
  // Progress is recalculated from the table's stream a few seconds on.
  await expect
    .poll(
      async () =>
        (
          await student.core.course.myEnrolment.query({
            courseId: course.courseId,
          })
        )?.progressPercent,
      { timeout: 30_000 },
    )
    .toBe(100);

  await instructor.instructor.course.archive.mutate({
    courseId: course.courseId,
  });
});

test('a partial refund keeps access', async () => {
  const instructor = await apiUser('Ines', ['instructor']);
  const course = await createPricedCourseViaApi(
    instructor,
    uniqueName('E2E part-refunded course'),
  );
  const student = await apiStudent('Pat');
  const sessionId = await buy(student, course.courseId);

  await refundSession(sessionId, 500);

  // Nothing to wait for: the refund's notice changes nothing, so give it a
  // moment to arrive and check that access stayed.
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  expect(
    (await student.core.course.myEnrolment.query({ courseId: course.courseId }))
      ?.status,
  ).not.toBe('dropped');

  await instructor.instructor.course.archive.mutate({
    courseId: course.courseId,
  });
});

test('a refunded student of a course since made free enrols without paying', async () => {
  const instructor = await apiUser('Ines', ['instructor']);
  const course = await createPricedCourseViaApi(
    instructor,
    uniqueName('E2E refunded then free'),
  );
  const student = await apiStudent('Ria');
  const sessionId = await buy(student, course.courseId);
  await student.core.contentItem.complete.mutate(course.reading);

  await refundSession(sessionId);
  await waitForEnrolment(student, course.courseId, true);
  await instructor.instructor.course.setPrice.mutate({
    courseId: course.courseId,
    priceAmount: 0,
    priceCurrency: 'USD',
  });
  await student.core.course.enrol.mutate({ courseId: course.courseId });

  const enrolment = await student.core.course.myEnrolment.query({
    courseId: course.courseId,
  });
  expect(enrolment?.status).not.toBe('dropped');
  await expect
    .poll(
      async () =>
        (
          await student.core.course.myEnrolment.query({
            courseId: course.courseId,
          })
        )?.progressPercent,
      { timeout: 30_000 },
    )
    .toBe(100);

  await instructor.instructor.course.archive.mutate({
    courseId: course.courseId,
  });
});
