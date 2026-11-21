/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  createDiscussionCourse,
  enrolledStudent,
  newPostId,
} from '../helpers/discussion.js';
import { expect, test } from '../helpers/table-invariants.js';
import { uniqueName } from '../helpers/users.js';

// One student answering the first-lesson prompt five times and dismissing it,
// all at the same moment, ends with exactly one state on the enrolment and a
// list that agrees with it.

const ANSWERS = 5;

test('answering and dismissing the first-lesson prompt at once leaves one state', async () => {
  const { key } = await createDiscussionCourse(uniqueName('Prompt race'));
  const student = await enrolledStudent('Sam', key.courseId);

  const results = await Promise.allSettled([
    ...Array.from({ length: ANSWERS }, (_, i) =>
      student.core.discussion.answerPrompt.mutate({
        ...key,
        postId: newPostId(),
        body: `Answer number ${i}.`,
      }),
    ),
    student.core.course.dismissFirstLessonPrompt.mutate({
      courseId: key.courseId,
    }),
  ]);

  const answers = results.slice(0, ANSWERS);
  const dismissal = results[ANSWERS];
  const answered = answers.filter((r) => r.status === 'fulfilled').length;
  expect(answered).toBeLessThanOrEqual(1);
  // Exactly one of the six requests won.
  expect(answered + (dismissal.status === 'fulfilled' ? 1 : 0)).toBe(1);

  const enrolment = await student.core.course.myEnrolment.query({
    courseId: key.courseId,
  });
  expect(enrolment?.firstLessonPromptState).toBe(
    answered === 1 ? 'answered' : 'dismissed',
  );

  const { items } = await student.core.discussion.listQuestions.query(key);
  expect(items.filter((item) => item.promptAnswer)).toHaveLength(answered);
});
