/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  ask,
  createDiscussionCourse,
  enrolledStudent,
  readThread,
  reply,
} from '../helpers/discussion.js';
import { expect, test } from '../helpers/table-invariants.js';
import { uniqueName } from '../helpers/users.js';

// Replies, votes and reports from several students at the same moment, with
// the instructor hiding, unhiding and accepting in that moment too, leave the
// question's counts, accepted answer and unanswered state matching what the
// API lists (#280).

const STUDENTS = 6;

test('replies, votes, reports and moderation at once leave the counts right', async () => {
  const { instructor, key } = await createDiscussionCourse(
    uniqueName('Discussion counters'),
  );
  const asker = await enrolledStudent('Ann', key.courseId);
  const students = await Promise.all(
    Array.from({ length: STUDENTS }, (_, i) =>
      enrolledStudent(`Stu${i}`, key.courseId),
    ),
  );
  const question = await ask(asker, key, 'Who answers first?');
  const threadId = question.postId;
  const toHide = await reply(students[0], key, threadId, 'Hide and unhide me.');
  const toAccept = await reply(students[1], key, threadId, 'Accept me.');
  const toReport = await reply(students[2], key, threadId, 'Report me.');
  const post = (postId: string) => ({ ...key, threadId, postId });
  const staff = instructor.instructor.discussion;
  // Nobody votes on or reports their own post.
  const voters = students.filter((_, i) => i !== 1);
  const reporters = students.filter((_, i) => i !== 2);

  await Promise.all([
    // New replies, one each.
    ...students.map((student, i) =>
      reply(student, key, threadId, `Reply number ${i}.`),
    ),
    // Votes on the answer-to-be, and on the question by everyone.
    ...voters.map((student) =>
      student.core.discussion.vote.mutate({
        ...post(toAccept.postId),
        voted: true,
      }),
    ),
    ...students.map((student) =>
      student.core.discussion.vote.mutate({ ...post(threadId), voted: true }),
    ),
    // Reports on one reply.
    ...reporters.map((student) =>
      student.core.discussion.report.mutate(post(toReport.postId)),
    ),
    // The instructor, in the same moment.
    (async () => {
      await staff.hide.mutate(post(toHide.postId));
      await staff.unhide.mutate(post(toHide.postId));
    })(),
    instructor.core.discussion.accept.mutate({
      ...key,
      threadId,
      postId: toAccept.postId,
    }),
  ]);

  const {
    question: read,
    accepted,
    replies,
  } = await readThread(asker, key, threadId);
  const shown = [accepted, ...replies].filter(
    (post) => post?.state === 'shown',
  );
  // The three first replies and one more from each student.
  expect(shown).toHaveLength(3 + STUDENTS);
  expect(accepted?.postId).toBe(toAccept.postId);
  expect(accepted?.voteCount).toBe(voters.length);
  expect(read.voteCount).toBe(STUDENTS);
  expect(read.answered).toBe(true);

  const [listed] = (await asker.core.discussion.listQuestions.query(key)).items;
  expect(listed).toMatchObject({
    postId: threadId,
    replyCount: shown.length,
    voteCount: STUDENTS,
    answered: true,
  });

  const reported = await staff.reported.query({ courseId: key.courseId });
  expect(
    reported.items.find((item) => item.postId === toReport.postId)?.reportCount,
  ).toBe(reporters.length);
  const answered = await staff.unanswered.query({ courseId: key.courseId });
  expect(answered.items.map((item) => item.postId)).not.toContain(threadId);
});
