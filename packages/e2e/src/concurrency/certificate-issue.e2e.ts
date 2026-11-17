/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type ApiUser,
  apiUser,
  createPublishedCourseViaApi,
} from '../helpers/api.js';
import { waitForQueuesToDrain } from '../helpers/router.js';
import { expect, test } from '../helpers/table-invariants.js';
import { uniqueName } from '../helpers/users.js';

// A certificate is issued once however many progress recalculations run for
// the student at the same moment (#276): completing the last item, and the
// instructor's curriculum edits, each start one.

// How many curriculum edits race the final completion.
const EDITS = 4;

let instructor: ApiUser;
let course: Awaited<ReturnType<typeof createPublishedCourseViaApi>>;
let student: ApiUser;

test.beforeEach(async () => {
  instructor = await apiUser('Ines', ['instructor']);
  course = await createPublishedCourseViaApi(
    instructor,
    uniqueName('Certificate race'),
  );
  student = await apiUser('Sam', ['student']);
  await student.core.course.enrol.mutate({ courseId: course.courseId });
});

// Archived once done, so the courses these tests publish don't crowd the
// student portal's catalogue and search.
test.afterEach(async () => {
  await instructor.instructor.course.archive.mutate({
    courseId: course.courseId,
  });
});

test('completing the last item while the curriculum changes issues one certificate', async () => {
  for (const item of course.texts) {
    await student.core.contentItem.complete.mutate(item);
  }
  const { questionsHash } = await student.core.quiz.view.query(course.quiz);

  // The last item's completion, racing edits that change what is visible
  // (each also recalculates the student's progress).
  const edits = Array.from({ length: EDITS }, (_, index) =>
    index % 2 === 0
      ? instructor.instructor.contentItem.hide.mutate(course.texts[1]!)
      : instructor.instructor.contentItem.publish.mutate(course.texts[1]!),
  );
  const results = await Promise.allSettled([
    student.core.quiz.submitAttempt.mutate({
      ...course.quiz,
      questionsHash,
      answers: { q1: ['a'] },
    }),
    ...edits,
  ]);
  expect(results[0]?.status).toBe('fulfilled');

  // Progress settles a few seconds later, and with it the certificate.
  await expect
    .poll(
      async () =>
        (await student.core.certificate.myCertificates.query()).length,
      {
        timeout: 30_000,
      },
    )
    .toBe(1);
  const [issued] = await student.core.certificate.myCertificates.query();
  expect(issued?.courseId).toBe(course.courseId);

  // Later recalculations, one more edit's worth, leave it alone: one
  // certificate, one stable ID, still verifiable by anyone.
  await instructor.instructor.contentItem.publish
    .mutate(course.texts[1]!)
    .catch(() => undefined);
  await waitForQueuesToDrain();
  const after = await student.core.certificate.myCertificates.query();
  expect(after).toHaveLength(1);
  expect(after[0]?.certificateId).toBe(issued?.certificateId);
  const verified = await student.core.certificate.verify.query({
    certificateId: issued!.certificateId,
  });
  expect(verified.courseTitle).toBe(issued?.courseTitle);
});
