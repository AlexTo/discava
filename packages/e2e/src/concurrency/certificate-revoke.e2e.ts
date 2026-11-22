/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type ApiUser,
  apiUser,
  createPublishedCourseViaApi,
} from '../helpers/api.js';
import { expect, test } from '../helpers/table-invariants.js';
import { uniqueName } from '../helpers/users.js';

// Revoking or restoring one certificate from several requests at once (#594)
// changes it once: one event, every request answered without an error.

const REQUESTS = 3;

let instructor: ApiUser;
let admin: ApiUser;
let courseId: string;
let certificateId: string;

test.beforeEach(async () => {
  instructor = await apiUser('Ines', ['instructor']);
  admin = await apiUser('Ada', ['admin']);
  const course = await createPublishedCourseViaApi(
    instructor,
    uniqueName('Certificate revoke race'),
  );
  courseId = course.courseId;
  const student = await apiUser('Sam', ['student']);
  await student.core.course.enrol.mutate({ courseId });
  for (const item of course.texts) {
    await student.core.contentItem.complete.mutate(item);
  }
  const { questionsHash } = await student.core.quiz.view.query(course.quiz);
  await student.core.quiz.submitAttempt.mutate({
    ...course.quiz,
    questionsHash,
    answers: { q1: ['a'] },
  });
  await expect
    .poll(
      async () =>
        (await student.core.certificate.myCertificates.query()).length,
      { timeout: 30_000 },
    )
    .toBe(1);
  [{ certificateId }] = await student.core.certificate.myCertificates.query();
});

test.afterEach(async () => {
  await instructor.instructor.course.archive.mutate({ courseId });
});

const events = async (type: 'revoked' | 'restored') =>
  (await admin.admin.certificate.get.query({ certificateId })).history.filter(
    (event) => event.type === type,
  );

test('simultaneous revocations from the instructor and an administrator revoke once', async () => {
  const results = await Promise.allSettled([
    ...Array.from({ length: REQUESTS }, () =>
      instructor.instructor.certificate.revoke.mutate({
        courseId,
        certificateId,
        reason: 'issued-in-error',
      }),
    ),
    ...Array.from({ length: REQUESTS }, () =>
      admin.admin.certificate.revoke.mutate({
        certificateId,
        reason: 'refunded',
      }),
    ),
  ]);

  expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
  const record = await admin.admin.certificate.get.query({ certificateId });
  expect(record.status).toBe('revoked');
  expect(await events('revoked')).toHaveLength(1);
});

test('simultaneous restorations restore once', async () => {
  await instructor.instructor.certificate.revoke.mutate({
    courseId,
    certificateId,
    reason: 'issued-in-error',
  });

  const results = await Promise.allSettled([
    ...Array.from({ length: REQUESTS }, () =>
      instructor.instructor.certificate.restore.mutate({
        courseId,
        certificateId,
      }),
    ),
    ...Array.from({ length: REQUESTS }, () =>
      admin.admin.certificate.restore.mutate({ certificateId }),
    ),
  ]);

  expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
  const record = await admin.admin.certificate.get.query({ certificateId });
  expect(record.status).toBe('valid');
  expect(await events('restored')).toHaveLength(1);
});
