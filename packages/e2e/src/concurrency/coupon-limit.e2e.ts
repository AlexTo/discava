/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  checkoutWithCode,
  createCode,
  createCouponCourse,
  failureOf,
  newStudent,
} from '../helpers/coupon.js';
import { ordersFor } from '../helpers/payment.js';
import { expect, test } from '../helpers/table-invariants.js';

// A code's limit under requests fired at the same moment (#71): the claim is
// one conditional write, so the count never passes the limit.

const USED_UP = 'This code has been used the maximum number of times';

test('a limit of 3 enrols exactly 3 of 10 students at once', async () => {
  const { instructor, courseId } = await createCouponCourse('Coupon limit');
  const { code } = await createCode(instructor, courseId, {
    percent: 100,
    maxRedemptions: 3,
  });
  const students = await Promise.all(
    Array.from({ length: 10 }, () => newStudent('Lim')),
  );

  const first = await Promise.allSettled(
    students.map((student) => checkoutWithCode(student, courseId, code)),
  );
  expect(
    first.filter(({ status }) => status === 'fulfilled').length,
  ).toBeLessThanOrEqual(3);

  // A CONFLICT is a lost race: retry it until it resolves.
  const settle = async (
    student: (typeof students)[number],
    attempt: PromiseSettledResult<unknown>,
  ) => {
    let result = attempt;
    for (let tries = 0; tries < 10; tries++) {
      if (result.status === 'fulfilled') return 'enrolled';
      const failure = failureOf(result.reason);
      if (failure.code !== 'CONFLICT') return failure.message;
      result = (
        await Promise.allSettled([checkoutWithCode(student, courseId, code)])
      )[0] as PromiseSettledResult<unknown>;
    }
    return 'unresolved';
  };
  const outcomes = await Promise.all(
    students.map((student, index) =>
      settle(student, first[index] as PromiseSettledResult<unknown>),
    ),
  );

  expect(outcomes.filter((outcome) => outcome === 'enrolled')).toHaveLength(3);
  expect(outcomes.filter((outcome) => outcome === USED_UP)).toHaveLength(7);
  const { items } = await instructor.instructor.coupon.list.query({ courseId });
  expect(items.find((coupon) => coupon.code === code)?.redeemedCount).toBe(3);

  await instructor.instructor.course.archive.mutate({ courseId });
});

test('one student firing the same request five times is enrolled once', async () => {
  const { instructor, courseId } = await createCouponCourse('Coupon repeat');
  const { code } = await createCode(instructor, courseId, { percent: 100 });
  const student = await newStudent('Rep');

  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => checkoutWithCode(student, courseId, code)),
  );
  // Calls that lost a race are retried until they resolve, as the portal does.
  const resolved = await Promise.all(
    results.map(async (result) => {
      let current: PromiseSettledResult<unknown> = result;
      for (
        let tries = 0;
        tries < 10 && current.status === 'rejected';
        tries++
      ) {
        if (failureOf(current.reason).code !== 'CONFLICT') break;
        current = (
          await Promise.allSettled([checkoutWithCode(student, courseId, code)])
        )[0] as PromiseSettledResult<unknown>;
      }
      return current;
    }),
  );

  for (const result of resolved) {
    expect(result).toEqual({ status: 'fulfilled', value: { enrolled: true } });
  }
  expect(await ordersFor(student.sub, courseId)).toHaveLength(1);
  const { items } = await instructor.instructor.coupon.list.query({ courseId });
  expect(items.find((coupon) => coupon.code === code)?.redeemedCount).toBe(1);
  expect(
    await student.core.course.myEnrolment.query({ courseId }),
  ).toMatchObject({ status: 'active' });

  await instructor.instructor.course.archive.mutate({ courseId });
});
