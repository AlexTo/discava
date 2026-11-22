/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { createCoreTableService } from '@discava/core-table';
import {
  type ApiUser,
  addCourseInstructor,
  apiUser,
  createCaptionedVideoViaApi,
} from '../helpers/api.js';
import { expect, test } from '../helpers/table-invariants.js';
import { uniqueName } from '../helpers/users.js';
import { setVideoQuestionsViaApi } from '../helpers/video-questions.js';

// Requests fired at the same moment, as two tabs or a double click would. Each
// test checks what the callers were told; the table-invariants fixture then
// checks the table they left behind.

let instructor: ApiUser;
let student: ApiUser;
let video: Awaited<ReturnType<typeof createCaptionedVideoViaApi>>;
let contentHash: string;

const errorCodes = (results: PromiseSettledResult<unknown>[]) =>
  results.flatMap((result) =>
    result.status === 'rejected'
      ? [(result.reason as { data?: { code?: string } }).data?.code]
      : [],
  );

test.beforeEach(async () => {
  instructor = await apiUser('Ines', ['instructor']);
  video = await createCaptionedVideoViaApi(
    instructor,
    uniqueName('Video answer race'),
  );
  await setVideoQuestionsViaApi(instructor, video, [
    {
      questionId: 'q1',
      prompt: 'What is on screen?',
      options: ['Colour bars', 'A cat'],
      correct: 0,
      atSeconds: 1,
    },
  ]);
  await instructor.instructor.course.publish.mutate({
    courseId: video.courseId,
  });
  student = await apiUser('Sam', ['student']);
  await student.core.course.enrol.mutate({ courseId: video.courseId });
  const { questions } = await student.core.videoQuestion.view.query(video);
  contentHash = questions[0]!.contentHash;
});

// Archived once done, so the course doesn't crowd the catalogue and search.
test.afterEach(async () => {
  await instructor.instructor.course.archive.mutate({
    courseId: video.courseId,
  });
});

const studentActivityCount = async () => {
  const coreTable = await createCoreTableService();
  const { data } = await coreTable.entities.contentItem.get(video).go();
  return data?.studentActivityCount;
};

test('one learner’s two different answers to one question record one', async () => {
  const answer = (optionId: string) =>
    student.core.videoQuestion.answer.mutate({
      ...video,
      questionId: 'q1',
      optionIds: [optionId],
      contentHash,
    });

  const results = await Promise.allSettled([answer('q1-0'), answer('q1-1')]);

  // Whatever won, every caller is told the one answer on record.
  const told = results.flatMap((r) =>
    r.status === 'fulfilled' ? [r.value] : [],
  );
  expect(told).toHaveLength(2);
  expect(new Set(told.map((r) => r.optionIds.join())).size).toBe(1);
  expect(told.filter((r) => r.recorded)).toHaveLength(1);
  const { answers } = await student.core.videoQuestion.view.query(video);
  expect(Object.keys(answers)).toEqual(['q1']);
  expect(answers.q1!.optionIds).toEqual(told[0]!.optionIds);
});

test('a first answer and Mark as done at once count the learner on the video once', async () => {
  const before = (await studentActivityCount()) ?? 0;

  await Promise.allSettled([
    student.core.videoQuestion.answer.mutate({
      ...video,
      questionId: 'q1',
      optionIds: ['q1-0'],
      contentHash,
    }),
    student.core.contentItem.complete.mutate(video),
  ]);

  expect(await studentActivityCount()).toBe(before + 1);
});

test('two instructors saving the questions from one version give one CONFLICT', async () => {
  const second = await apiUser('Ida', ['instructor']);
  await addCourseInstructor(video.courseId, second);
  const { quizVersion } = await student.core.videoQuestion.view.query(video);

  const save = (who: ApiUser, prompt: string) =>
    setVideoQuestionsViaApi(
      who,
      video,
      [
        {
          questionId: 'q1',
          prompt,
          options: ['Colour bars', 'A cat'],
          correct: 0,
          atSeconds: 1,
        },
      ],
      quizVersion,
    );

  const results = await Promise.allSettled([
    save(instructor, 'From the first instructor'),
    save(second, 'From the second instructor'),
  ]);

  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(errorCodes(results)).toEqual(['CONFLICT']);
});
