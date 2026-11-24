/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AppRouter as CoreApi } from '@discava/core-api';
import type { Page } from '@playwright/test';
import { createTRPCClient, httpLink } from '@trpc/client';
import { type ApiUser, apiUser, connectLocalPayments } from './api.js';
import {
  addLesson,
  addModule,
  addTextItem,
  createCourse,
  publishCourse,
} from './instructor-portal.js';
import { apiStudent, createPricedCourseViaApi } from './payment.js';
import { PORTALS, SERVICES } from './portals.js';
import { expect } from './table-invariants.js';
import { newUser, signIn, uniqueName } from './users.js';

// Steps for the coupon scenarios (`scenarios/coupon.e2e.ts`) and the limit's
// concurrency test (`concurrency/coupon-limit.e2e.ts`). Only the local stack
// is needed: a code that takes the whole price never reaches Stripe.

// A published course priced at 20.00 USD, owned by a fresh instructor, with
// payments marked connected (the state a checkout needs).
export const createCouponCourse = async (label = 'Coupon course') => {
  await connectLocalPayments();
  const instructor = await apiUser('Cora', ['instructor']);
  const title = uniqueName(label);
  const { courseId } = await createPricedCourseViaApi(instructor, title, 2000);
  return { instructor, title, courseId };
};

// A code on the course, made through instructor-api.
export const createCode = async (
  instructor: ApiUser,
  courseId: string,
  options: { percent: number; maxRedemptions?: number },
) =>
  instructor.instructor.coupon.create.mutate({
    courseId,
    type: 'percent',
    value: options.percent,
    maxRedemptions: options.maxRedemptions,
  });

// A new student with no enrolments.
export const newStudent = (givenName = 'Sam') => apiStudent(givenName);

export type CouponStudent = Awaited<ReturnType<typeof newStudent>>;

// Starts a checkout with a code and returns what core-api answered. Checkout
// builds the hosted page's return addresses from the request's origin, which
// a bare API client does not send.
export const checkoutWithCode = (
  student: CouponStudent,
  courseId: string,
  couponCode: string,
) =>
  createTRPCClient<CoreApi>({
    links: [
      httpLink({
        url: SERVICES.coreApi,
        headers: {
          authorization: `Bearer ${student.accessToken}`,
          origin: PORTALS.student,
        },
      }),
    ],
  }).payment.checkout.mutate({ courseId, couponCode });

// The tRPC error code and message of a rejected call.
export const failureOf = (reason: unknown) => {
  const { data, message } = reason as {
    data?: { code?: string };
    message: string;
  };
  return { code: data?.code, message };
};

// A fresh instructor, signed in on `page`, publishes a course priced at 20.00
// and opens its Coupons screen. Payments are marked connected first.
export const publishPricedCourseInPortal = async (
  page: Page,
  title: string,
) => {
  await connectLocalPayments();
  await page.goto(`${PORTALS.instructor}/my-courses`);
  await signIn(page, newUser('Cora', ['instructor']));
  await createCourse(page, {
    title,
    summary: 'A course discounted by the end-to-end tests.',
  });
  await page.getByLabel('Price', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Save price' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await addModule(page, 'Module one');
  await addLesson(page, 'Lesson one');
  await addTextItem(page, { title: 'Reading one', body: 'Discounted.' });
  await publishCourse(page);
  await page.getByRole('link', { name: 'Coupons' }).click();
  await expect(page.getByText('No codes yet')).toBeVisible();
};

// Makes a percent code in the Coupons screen's dialog and waits for it to
// be listed.
export const createCodeInScreen = async (
  page: Page,
  code: string,
  percent: number,
  maxRedemptions?: number,
) => {
  await page.getByRole('button', { name: 'Create code' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Code (optional)').fill(code);
  await dialog.getByLabel('Percent', { exact: true }).fill(String(percent));
  if (maxRedemptions !== undefined) {
    await dialog
      .getByLabel('Maximum redemptions (optional)')
      .fill(String(maxRedemptions));
  }
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText(code, { exact: true })).toBeVisible();
};

// A code no other run uses: 4 to 24 of A-Z, 0-9 and dashes.
export const uniqueCode = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
    .toUpperCase()
    .slice(0, 20);

// The student signs in from the course page's "Sign in to buy" prompt.
export const signInToBuy = async (page: Page, givenName = 'Cleo') => {
  await page.getByRole('button', { name: 'Sign in to buy' }).click();
  await page
    .getByRole('dialog', { name: 'Sign in to buy' })
    .getByRole('link', { name: 'Continue to sign in' })
    .click();
  await signIn(page, newUser(givenName, ['student']));
};

// Applies a code in the pay area.
export const applyCode = async (page: Page, code: string) => {
  const field = page.getByLabel('Discount code');
  if (!(await field.isVisible())) {
    await page.getByRole('button', { name: 'Have a code?' }).click();
  }
  await field.fill(code);
  await page.getByRole('button', { name: 'Apply' }).click();
};
