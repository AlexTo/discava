/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { apiUser } from '../helpers/api.js';
import { createPricedCourseViaApi } from '../helpers/payment.js';
import { screenshot } from '../helpers/screenshots.js';
import { connectStripeStandIn } from '../helpers/stripe-stand-in.js';
import { openCourse } from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// A student applies a discount code on the course page and pays the
// discounted price on the stand-in's hosted page.
test.beforeEach(connectStripeStandIn);

test('a student applies a code and pays the discounted price', async ({
  browser,
}) => {
  const title = uniqueName('E2E discounted course');
  const instructor = await apiUser('Ines', ['instructor']);
  const course = await createPricedCourseViaApi(instructor, title, 2000);
  const { code } = await instructor.instructor.coupon.create.mutate({
    courseId: course.courseId,
    type: 'percent',
    value: 25,
    maxRedemptions: 5,
  });
  const page = await browser.newPage();
  const user = newUser('Cleo', ['student']);

  await test.step('the student signs in and a wrong code is refused', async () => {
    await openCourse(page, title);
    await page.getByRole('button', { name: 'Sign in to buy' }).click();
    await page
      .getByRole('dialog', { name: 'Sign in to buy' })
      .getByRole('link', { name: 'Continue to sign in' })
      .click();
    await signIn(page, user);
    await page.getByRole('button', { name: 'Have a code?' }).click();
    await page.getByLabel('Discount code').fill('NOT-A-CODE');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(
      page.getByText('This code is not valid for this course'),
    ).toBeVisible();
    await screenshot(page, 'coupon-refused');
  });

  await test.step('the right code shows the discounted total', async () => {
    await page.getByLabel('Discount code').fill(code.toLowerCase());
    await page.getByRole('button', { name: 'Apply' }).click();
    const summary = page.getByLabel('Price with code');
    await expect(summary.getByText('$20.00')).toBeVisible();
    await expect(summary.getByText('−$5.00')).toBeVisible();
    await expect(summary.getByText('$15.00')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Pay $15.00' }),
    ).toBeVisible();
    await screenshot(page, 'coupon-applied');
  });

  await test.step('removing the code restores the list price', async () => {
    await page.getByRole('button', { name: 'Remove code' }).click();
    await expect(page.getByRole('button', { name: 'Buy now' })).toBeVisible();
    await screenshot(page, 'coupon-removed');
    await page.getByRole('button', { name: 'Have a code?' }).click();
    await page.getByLabel('Discount code').fill(code);
    await page.getByRole('button', { name: 'Apply' }).click();
  });

  await test.step('paying charges the discounted amount and enrols the student', async () => {
    await page.getByRole('button', { name: 'Pay $15.00' }).click();
    await page.waitForURL(/\/stripe\/pay\//);
    await screenshot(page, 'coupon-hosted-page');
    await page.getByRole('button', { name: 'Pay', exact: true }).click();
    await page.waitForURL(/\/learn\/[0-9a-f-]+\/(lesson\/[0-9a-f-]+|home)$/, {
      timeout: 30_000,
    });
    await expect(page.getByText("You're enrolled in")).toBeVisible();
    await screenshot(page, 'coupon-enrolled');
  });

  await test.step('the code now counts one redemption', async () => {
    const { items } = await instructor.instructor.coupon.list.query({
      courseId: course.courseId,
    });
    expect(items.find((coupon) => coupon.code === code)).toMatchObject({
      redeemedCount: 1,
    });
  });

  await instructor.instructor.course.archive.mutate({
    courseId: course.courseId,
  });
});

// A code that takes the whole price enrols the student with no payment page.
test('a code that makes the course free enrols the student directly', async ({
  browser,
}) => {
  const title = uniqueName('E2E free-by-code course');
  const instructor = await apiUser('Ines', ['instructor']);
  const course = await createPricedCourseViaApi(instructor, title, 2000);
  const { code } = await instructor.instructor.coupon.create.mutate({
    courseId: course.courseId,
    type: 'percent',
    value: 100,
    maxRedemptions: 5,
  });
  const page = await browser.newPage();
  const user = newUser('Cleo', ['student']);

  await test.step('applying the code changes the button to Enrol for free', async () => {
    await openCourse(page, title);
    await page.getByRole('button', { name: 'Sign in to buy' }).click();
    await page
      .getByRole('dialog', { name: 'Sign in to buy' })
      .getByRole('link', { name: 'Continue to sign in' })
      .click();
    await signIn(page, user);
    await page.getByRole('button', { name: 'Have a code?' }).click();
    await page.getByLabel('Discount code').fill(code);
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('No payment is needed.')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Enrol for free' }),
    ).toBeVisible();
    await screenshot(page, 'free-coupon-applied');
  });

  await test.step('pressing it enrols the student without a payment page', async () => {
    await page.getByRole('button', { name: 'Enrol for free' }).click();
    await page.waitForURL(/\/learn\/[0-9a-f-]+\/(lesson\/[0-9a-f-]+|home)$/, {
      timeout: 30_000,
    });
    expect(page.url()).not.toContain('/stripe/pay/');
    await screenshot(page, 'free-coupon-enrolled');
  });

  await test.step('the code counts one redemption', async () => {
    const { items } = await instructor.instructor.coupon.list.query({
      courseId: course.courseId,
    });
    expect(items.find((coupon) => coupon.code === code)).toMatchObject({
      redeemedCount: 1,
    });
  });

  await instructor.instructor.course.archive.mutate({
    courseId: course.courseId,
  });
});
