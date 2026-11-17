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

// Students enrolling and completing at the same moment (#278): the analytics
// handler adds to counters that all of them change, so each change has to
// count once and none may be lost. The dashboard's figures equal the number
// of students; the invariant check afterwards compares every aggregate with
// the records.

// How many students act at once.
const STUDENTS = 6;

let instructor: ApiUser;
let course: Awaited<ReturnType<typeof createPublishedCourseViaApi>>;

test.beforeEach(async () => {
  instructor = await apiUser('Ines', ['instructor']);
  course = await createPublishedCourseViaApi(
    instructor,
    uniqueName('Analytics race'),
  );
});

// Archived once done, so the courses these tests publish don't crowd the
// student portal's catalogue and search.
test.afterEach(async () => {
  await instructor.instructor.course.archive.mutate({
    courseId: course.courseId,
  });
});

test('several students enrolling and completing at once are all counted', async () => {
  const students = await Promise.all(
    Array.from({ length: STUDENTS }, () => apiUser('Sam', ['student'])),
  );

  const results = await Promise.allSettled(
    students.map(async (student) => {
      await student.core.course.enrol.mutate({ courseId: course.courseId });
      await student.core.contentItem.complete.mutate(course.texts[0]);
    }),
  );
  expect(results.filter(({ status }) => status === 'rejected')).toEqual([]);

  await expect
    .poll(
      async () => {
        const summaries =
          await instructor.instructor.analytics.courseSummaries.query();
        const summary = summaries.find((s) => s.courseId === course.courseId);
        return {
          enrolments: summary?.enrolments,
          activeThisWeek: summary?.activeThisWeek,
        };
      },
      {
        message: "The card's figures equal the number of students",
        timeout: 30_000,
      },
    )
    .toEqual({ enrolments: STUDENTS, activeThisWeek: STUDENTS });
});
