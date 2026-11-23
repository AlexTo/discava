/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AppRouter as CoreApi } from '@discava/core-api';
import { createCoreTableService } from '@discava/core-table';
import { expect } from '@playwright/test';
import { createTRPCClient, httpLink } from '@trpc/client';
import { type ApiUser, accessTokenFor, apiClients, textBody } from './api.js';
import { PORTALS, SERVICES } from './portals.js';
import { actOnHostedPage, sessionIdOf } from './stripe-stand-in.js';

// Buying through the APIs, for the scenarios that fire requests at the same
// moment or that need no browser. The browser flow is in
// scenarios/course-purchase.e2e.ts.

// A new student, signed in. The token is kept for `startCheckout`: checkout
// builds the hosted page's return addresses from the request's origin, which
// a bare API client does not send.
export const apiStudent = async (givenName: string) => {
  const accessToken = await accessTokenFor(['student'], givenName);
  return { ...apiClients(accessToken), accessToken };
};

// A published course with one lesson holding one reading, priced in minor
// units (1999 is 19.99); a price of 0 leaves it free. One item, so completing
// it completes the course.
export const createPricedCourseViaApi = async (
  instructor: ApiUser,
  title: string,
  priceAmount = 1999,
  priceCurrency = 'USD',
) => {
  const api = instructor.instructor;
  const { courseId } = await api.course.create.mutate({ title });
  const { moduleId } = await api.module.create.mutate({
    courseId,
    title: 'Module 1',
  });
  const { lessonId } = await api.lesson.create.mutate({
    courseId,
    moduleId,
    title: 'Lesson 1',
  });
  const { contentItemId } = await api.contentItem.createText.mutate({
    courseId,
    moduleId,
    lessonId,
    title: 'Reading 1',
    body: textBody('Reading 1'),
  });
  if (priceAmount > 0) {
    await api.course.setPrice.mutate({ courseId, priceAmount, priceCurrency });
  }
  await api.course.publish.mutate({ courseId });
  return { courseId, reading: { courseId, moduleId, lessonId, contentItemId } };
};

// Starts a checkout and returns the stand-in session it opened.
export const startCheckout = async (accessToken: string, courseId: string) => {
  const client = createTRPCClient<CoreApi>({
    links: [
      httpLink({
        url: SERVICES.coreApi,
        headers: {
          authorization: `Bearer ${accessToken}`,
          origin: PORTALS.student,
        },
      }),
    ],
  });
  const { checkoutUrl } = await client.payment.checkout.mutate({ courseId });
  return { checkoutUrl, sessionId: sessionIdOf(checkoutUrl) };
};

// Pays a started checkout on the stand-in.
export const pay = async (sessionId: string) => {
  expect(await actOnHostedPage(sessionId, 'pay')).toBe(303);
};

// Waits for the enrolment the signed webhook creates (or, with `ended`, the
// refund's webhook ends), polling as the other helpers do.
export const waitForEnrolment = async (
  student: ApiUser,
  courseId: string,
  ended = false,
) => {
  await expect
    .poll(
      async () => {
        const enrolment = await student.core.course.myEnrolment.query({
          courseId,
        });
        return enrolment ? enrolment.status === 'dropped' : undefined;
      },
      {
        message: `The enrolment never ${ended ? 'ended' : 'started'}`,
        timeout: 30_000,
      },
    )
    .toBe(ended);
};

// The student's orders for the course, as the table holds them.
export const ordersFor = async (userId: string, courseId: string) => {
  const coreTable = await createCoreTableService();
  const { data } = await coreTable.entities.order.query
    .byStudentCourse({ userId, courseId })
    .go({ pages: 'all' });
  return data;
};
