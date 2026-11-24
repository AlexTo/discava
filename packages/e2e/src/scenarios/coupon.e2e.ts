/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  applyCode,
  checkoutWithCode,
  createCode,
  createCodeInScreen,
  createCouponCourse,
  newStudent,
  publishPricedCourseInPortal,
  signInToBuy,
  uniqueCode,
} from '../helpers/coupon.js';
import { screenshot } from '../helpers/screenshots.js';
import { openCourse } from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { uniqueName } from '../helpers/users.js';

// The learner flow end to end on the local stack alone, with no Stripe: an
// instructor makes codes on the Coupons screen, a student applies them, and
// a code that takes the whole price enrols directly (FR-014).
test('an instructor makes codes and a student uses them', async ({
  browser,
}) => {
  const title = uniqueName('E2E coupon flow');
  const percent20 = uniqueCode('TWENTY');
  const free = uniqueCode('FREE');
  const instructor = await browser.newPage();
  const student = await browser.newPage();

  await test.step('the instructor creates a 20% and a 100% code and sees them listed', async () => {
    await publishPricedCourseInPortal(instructor, title);
    await createCodeInScreen(instructor, percent20, 20);
    await createCodeInScreen(instructor, free, 100);
    await expect(instructor.getByText(/20% off/)).toBeVisible();
    await expect(instructor.getByText(/100% off/)).toBeVisible();
    await screenshot(instructor, 'two codes listed');
  });

  await test.step('a student applies the 20% code in lower case and then removes it', async () => {
    await openCourse(student, title);
    await signInToBuy(student);
    await applyCode(student, percent20.toLowerCase());
    const summary = student.getByLabel('Price with code');
    await expect(summary.getByText('$20.00')).toBeVisible({ timeout: 2_000 });
    await expect(summary.getByText('−$4.00')).toBeVisible({ timeout: 2_000 });
    await expect(summary.getByText('$16.00')).toBeVisible({ timeout: 2_000 });
    await screenshot(student, 'twenty percent applied');
    await student.getByRole('button', { name: 'Remove code' }).click();
    await expect(
      student.getByRole('button', { name: 'Buy now' }),
    ).toBeVisible();
  });

  await test.step('the 100% code enrols the student with no payment page', async () => {
    await applyCode(student, free);
    await expect(
      student.getByRole('button', { name: 'Enrol for free' }),
    ).toBeVisible({ timeout: 2_000 });
    await screenshot(student, 'free code applied');
    await student.getByRole('button', { name: 'Enrol for free' }).click();
    await student.waitForURL(
      /\/learn\/[0-9a-f-]+\/(lesson\/[0-9a-f-]+|home)$/,
      {
        timeout: 5_000,
      },
    );
    expect(student.url()).not.toContain('/stripe/pay/');
    await screenshot(student, 'free code enrolled');
  });
});

// The refusals, through the API a student's browser calls.
test('a second use of a code is refused and refusals do not reveal which codes exist', async () => {
  const { instructor, courseId } = await createCouponCourse();
  const other = await createCouponCourse('Other coupon course');
  const { code } = await createCode(instructor, courseId, { percent: 100 });
  const { code: otherCode } = await createCode(
    other.instructor,
    other.courseId,
    {
      percent: 100,
    },
  );
  const sam = await newStudent();

  const refusal = (promise: Promise<unknown>) =>
    promise.then(
      () => undefined,
      (reason: Error) => reason.message,
    );

  const unknown = await refusal(
    sam.core.coupon.preview.query({ courseId, code: 'NOT-A-CODE' }),
  );
  const foreign = await refusal(
    sam.core.coupon.preview.query({ courseId, code: otherCode }),
  );
  expect(unknown).toBe('This code is not valid for this course');
  expect(foreign).toBe(unknown);

  expect(await checkoutWithCode(sam, courseId, code)).toEqual({
    enrolled: true,
  });
  // A free enrolment bought with a code can't be left (it has an order), so
  // a second use meets the enrolment first.
  const enrolled = 'You are already enrolled in this course';
  expect(await refusal(sam.core.coupon.preview.query({ courseId, code }))).toBe(
    enrolled,
  );
  await expect(checkoutWithCode(sam, courseId, code)).rejects.toThrow(enrolled);

  await instructor.instructor.course.archive.mutate({ courseId });
  await other.instructor.instructor.course.archive.mutate({
    courseId: other.courseId,
  });
});

// Managing a code that has been used.
test('an instructor disables a code and cannot delete or under-limit a used one', async ({
  browser,
}) => {
  const title = uniqueName('E2E coupon manage');
  const code = uniqueCode('MANAGE');
  const instructor = await browser.newPage();
  const student = await browser.newPage();

  await test.step('a code is made and one student redeems it', async () => {
    await publishPricedCourseInPortal(instructor, title);
    await createCodeInScreen(instructor, code, 100, 5);
  });

  await test.step('disabled, a student applying it sees "turned off"', async () => {
    await instructor.getByRole('button', { name: `Disable ${code}` }).click();
    await expect(
      instructor.getByText('Disabled', { exact: true }),
    ).toBeVisible();
    await openCourse(student, title);
    await signInToBuy(student);
    await applyCode(student, code);
    await expect(
      student.getByText('This code has been turned off'),
    ).toBeVisible();
    await screenshot(student, 'code turned off');
  });

  await test.step('enabled again, it works and enrols the student', async () => {
    await instructor.getByRole('button', { name: `Enable ${code}` }).click();
    await expect(instructor.getByText('Active', { exact: true })).toBeVisible();
    await applyCode(student, code);
    await student.getByRole('button', { name: 'Enrol for free' }).click();
    await student.waitForURL(
      /\/learn\/[0-9a-f-]+\/(lesson\/[0-9a-f-]+|home)$/,
      {
        timeout: 5_000,
      },
    );
  });

  await test.step('a redeemed code has no Delete and its limit cannot go below the count', async () => {
    await instructor.reload();
    await expect(instructor.getByText(/1 of 5 used/)).toBeVisible();
    await expect(
      instructor.getByRole('button', { name: `Delete ${code}` }),
    ).toHaveCount(0);
    await instructor
      .getByRole('button', { name: `Edit limits for ${code}` })
      .click();
    const dialog = instructor.getByRole('dialog');
    await dialog.getByLabel('Maximum redemptions').fill('0');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(
      dialog.getByText(/limit must be a whole number/),
    ).toBeVisible();
    await screenshot(instructor, 'limit below count refused');
  });
});
