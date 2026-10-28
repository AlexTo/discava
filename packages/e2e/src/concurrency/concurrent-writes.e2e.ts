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

// Requests fired at the same moment, as two tabs or a double click would, which
// the browser scenarios never do (#71). Each test checks what the callers were
// told; the table-invariants fixture then checks the table they left behind.

// How many requests each race fires at once.
const RACERS = 5;

const race = <T>(request: () => Promise<T>) =>
  Promise.allSettled(Array.from({ length: RACERS }, request));

const fulfilled = <T>(results: PromiseSettledResult<T>[]) =>
  results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );

const errorCodes = (results: PromiseSettledResult<unknown>[]) =>
  results.flatMap((result) =>
    result.status === 'rejected'
      ? [(result.reason as { data?: { code?: string } }).data?.code]
      : [],
  );

let instructor: ApiUser;
let course: Awaited<ReturnType<typeof createPublishedCourseViaApi>>;
let student: ApiUser;

test.beforeEach(async () => {
  instructor = await apiUser('Ines', ['instructor']);
  course = await createPublishedCourseViaApi(
    instructor,
    uniqueName('Concurrency'),
  );
  student = await apiUser('Sam', ['student']);
  await student.core.course.enrol.mutate({ courseId: course.courseId });
});

// Archived once done, so the courses these tests publish don't crowd the
// student portal's catalogue and search, which list the first 100 published
// courses (oldest first).
test.afterEach(async () => {
  await instructor.instructor.course.archive.mutate({
    courseId: course.courseId,
  });
});

test.describe('a student', () => {
  test('completing one item from several tabs records it once', async () => {
    const results = await race(() =>
      student.core.contentItem.complete.mutate(course.texts[0]),
    );

    const completions = fulfilled(results);
    expect(errorCodes(results)).toEqual([]);
    expect(
      new Set(completions.map(({ completedAt }) => completedAt)).size,
    ).toBe(1);
  });

  test('completing different items at once records them all', async () => {
    const results = await Promise.allSettled(
      course.texts.map((item) =>
        student.core.contentItem.complete.mutate(item),
      ),
    );

    expect(errorCodes(results)).toEqual([]);
    const { items } = await student.core.course.myItemCompletions.query({
      courseId: course.courseId,
    });
    expect(items).toHaveLength(course.texts.length);
  });

  test('submitting a quiz from several tabs uses no more than its attempts', async () => {
    const { questionsHash } = await student.core.quiz.view.query(course.quiz);

    const results = await race(() =>
      student.core.quiz.submitAttempt.mutate({
        ...course.quiz,
        questionsHash,
        answers: { q1: ['b'] },
      }),
    );

    // Two attempts allowed: the rest are refused, or gave up on the race.
    expect(fulfilled(results).length).toBeLessThanOrEqual(2);
    expect(
      errorCodes(results).every(
        (code) => code === 'PRECONDITION_FAILED' || code === 'CONFLICT',
      ),
    ).toBe(true);
    const { summary } = await student.core.quiz.myAttempts.query(course.quiz);
    expect(summary?.attemptsUsed).toBe(fulfilled(results).length);
  });

  test('completing an item while the course is archived keeps it consistent', async () => {
    const [completion, archive] = await Promise.allSettled([
      student.core.contentItem.complete.mutate(course.texts[0]),
      instructor.instructor.course.archive.mutate({
        courseId: course.courseId,
      }),
    ]);

    expect(archive.status).toBe('fulfilled');
    // Either the completion landed first, or the archived course refused it.
    if (completion.status === 'rejected') {
      expect(errorCodes([completion])).toEqual(['PRECONDITION_FAILED']);
    }
  });
});

test.describe('an instructor', () => {
  test('adding modules at once gives each its own place', async () => {
    const results = await race(() =>
      instructor.instructor.module.create.mutate({
        courseId: course.courseId,
        title: uniqueName('Module'),
      }),
    );

    const modules = fulfilled(results);
    expect(errorCodes(results)).toEqual([]);
    expect(new Set(modules.map(({ order }) => order)).size).toBe(RACERS);
  });

  test('adding lessons at once gives each its own place', async () => {
    const results = await race(() =>
      instructor.instructor.lesson.create.mutate({
        courseId: course.courseId,
        moduleId: course.moduleId,
        title: uniqueName('Lesson'),
      }),
    );

    const lessons = fulfilled(results);
    expect(errorCodes(results)).toEqual([]);
    expect(new Set(lessons.map(({ order }) => order)).size).toBe(RACERS);
  });

  test('adding items at once gives each its own place', async () => {
    const lesson = {
      courseId: course.courseId,
      moduleId: course.moduleId,
      lessonId: course.lessonId,
    };
    const results = await race(() =>
      instructor.instructor.contentItem.createText.mutate({
        ...lesson,
        title: uniqueName('Reading'),
        body: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }),
      }),
    );

    const items = fulfilled(results);
    expect(errorCodes(results)).toEqual([]);
    expect(new Set(items.map(({ order }) => order)).size).toBe(RACERS);
  });
});
