/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { apiUser } from '../helpers/api.js';
import { createReviewedCourse, enrolledStudent } from '../helpers/review.js';
import { expect, test } from '../helpers/table-invariants.js';

// Review writes fired at the same moment, as two tabs or a double click would
// (#279). Each test checks what the callers were told; the table-invariants
// fixture then checks the table they left behind, including that the course's
// count matches its reviews.

const RACERS = 5;

const errorCodes = (results: PromiseSettledResult<unknown>[]) =>
  results.flatMap((result) =>
    result.status === 'rejected'
      ? [(result.reason as { data?: { code?: string } }).data?.code]
      : [],
  );

const fulfilled = (results: PromiseSettledResult<unknown>[]) =>
  results.filter((result) => result.status === 'fulfilled');

test('one student posting several times at once makes one review', async () => {
  const { courseId } = await createReviewedCourse('Review race');
  const student = await enrolledStudent(courseId);

  const results = await Promise.allSettled(
    Array.from({ length: RACERS }, () =>
      student.core.review.post.mutate({ courseId, rating: 4 }),
    ),
  );

  expect(fulfilled(results)).toHaveLength(1);
  expect(
    errorCodes(results).every(
      (code) => code === 'CONFLICT' || code === 'PRECONDITION_FAILED',
    ),
  ).toBe(true);
  const summary = await student.core.review.summary.query({ courseId });
  expect(summary.count).toBe(1);
  expect(summary.stars[4]).toBe(1);
});

test('several students posting at once are all counted', async () => {
  const { courseId } = await createReviewedCourse('Review many');
  const students = await Promise.all(
    Array.from({ length: RACERS }, () => enrolledStudent(courseId)),
  );

  const results = await Promise.allSettled(
    students.map((student) =>
      student.core.review.post.mutate({ courseId, rating: 5 }),
    ),
  );

  const summary = await students[0].core.review.summary.query({ courseId });
  expect(summary.count).toBe(fulfilled(results).length);
  expect(summary.stars[5]).toBe(summary.count);
  expect(summary.count).toBeGreaterThan(0);
});

test('one student editing and deleting at the same moment, one wins', async () => {
  const { courseId } = await createReviewedCourse('Review edit delete');
  const student = await enrolledStudent(courseId);
  const { version } = await student.core.review.post.mutate({
    courseId,
    rating: 3,
  });

  const results = await Promise.allSettled([
    student.core.review.edit.mutate({ courseId, rating: 5, version }),
    student.core.review.delete.mutate({ courseId, version }),
  ]);

  expect(fulfilled(results)).toHaveLength(1);
  const mine = await student.core.review.mine.query({ courseId });
  const summary = await student.core.review.summary.query({ courseId });
  // Either the review was edited (one rating of 5) or deleted (none).
  expect(summary.count).toBe(mine ? 1 : 0);
  expect(summary.stars[5]).toBe(mine ? 1 : 0);
});

test('an admin removal racing a student edit leaves a removed review and a matching count', async () => {
  const { courseId } = await createReviewedCourse('Review remove edit');
  const student = await enrolledStudent(courseId);
  const admin = await apiUser('Cara', ['admin']);
  const { version } = await student.core.review.post.mutate({
    courseId,
    rating: 1,
    text: 'Rude.',
  });

  await Promise.allSettled([
    admin.admin.review.remove.mutate({
      courseId,
      reviewerId: student.sub,
      reason: 'Abusive language',
    }),
    student.core.review.edit.mutate({
      courseId,
      rating: 2,
      text: 'Still rude.',
      version,
    }),
  ]);

  const mine = await student.core.review.mine.query({ courseId });
  expect(mine?.status).toBe('removed');
  const summary = await student.core.review.summary.query({ courseId });
  expect(summary.count).toBe(0);
});
