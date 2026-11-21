/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { listAnnouncements } from './announcement.js';
import { submit } from './assignment.js';
import { completeContentItem, myItemCompletions } from './completion.js';
import { fileUrl, saveVideoPosition, videoUrl } from './content-item.js';
import { viewCourse } from './course.js';
import { myLessonProgress } from './lesson-progress.js';
import { myQuizAttempts, submitQuizAttempt, viewQuiz } from './quiz.js';

// What the mocked table holds for this test; each entity's `get` reads it.
const { db } = vi.hoisted(() => ({ db: {} as Record<string, any> }));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: new Proxy(
      {},
      {
        get: (_, name: string) => ({
          get: () => ({
            go: async () => ({ data: db[name] ?? null }),
          }),
        }),
      },
    ),
    collections: {
      curriculum: () => ({
        go: async () => ({
          data: {
            course: db.course ? [db.course] : [],
            module: [],
            lesson: [],
            contentItem: [],
          },
        }),
      }),
    },
  })),
}));

const router = t.router({
  viewCourse,
  myItemCompletions,
  completeContentItem,
  videoUrl,
  fileUrl,
  saveVideoPosition,
  myLessonProgress,
  listAnnouncements,
  myQuizAttempts,
  viewQuiz,
  submitQuizAttempt,
  submit,
});
const caller = callerFor(router, { sub: 'student-1' });

const ref = {
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
  contentItemId: 'item-1',
};

// Each content procedure, called with the minimum its input schema needs.
const calls = {
  'course.view': () => caller.viewCourse({ courseId: ref.courseId }),
  'course.myItemCompletions': () =>
    caller.myItemCompletions({ courseId: ref.courseId }),
  'contentItem.complete': () => caller.completeContentItem(ref),
  'contentItem.videoUrl': () => caller.videoUrl(ref),
  'contentItem.fileUrl': () => caller.fileUrl(ref),
  'contentItem.saveVideoPosition': () =>
    caller.saveVideoPosition({
      ...ref,
      versionId: 'v1',
      positionSeconds: 5,
      durationSeconds: 60,
    }),
  'course.myLessonProgress': () =>
    caller.myLessonProgress({ courseId: ref.courseId }),
  'announcement.list': () =>
    caller.listAnnouncements({ courseId: ref.courseId }),
  'quiz.myAttempts': () => caller.myQuizAttempts(ref),
  'quiz.view': () => caller.viewQuiz(ref),
  'quiz.submitAttempt': () =>
    caller.submitQuizAttempt({ ...ref, questionsHash: 'hash', answers: {} }),
  'assignment.submit': () =>
    caller.submit({ ...ref, objectKey: 'key', fileName: 'work.pdf' }),
};

const pricedCourse = {
  courseId: ref.courseId,
  title: 'A paid course',
  status: 'published',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  priceAmount: 4900,
  priceCurrency: 'usd',
};

const enrolment = {
  courseId: ref.courseId,
  userId: 'student-1',
  status: 'active',
  progressPercent: 0,
};

beforeEach(() => {
  for (const key of Object.keys(db)) delete db[key];
  db.course = pricedCourse;
});

// Invariant: a priced course's content is read only through an enrolment, and
// the only way to get one is a paid order (or having enrolled while it was
// free), so an unpaid student gets what they get for a free course.
describe('content of a priced published course', () => {
  it.each(Object.entries(calls))(
    '%s is FORBIDDEN for a student with no enrolment',
    async (_name, call) => {
      await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  );

  it.each(Object.entries(calls))(
    '%s is FORBIDDEN for a student whose enrolment was dropped',
    async (_name, call) => {
      db.enrolment = { ...enrolment, status: 'dropped' };
      await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  );

  it('is read as before by a student enrolled before the course was priced', async () => {
    db.enrolment = enrolment;
    await expect(calls['course.view']()).resolves.toMatchObject({
      courseId: ref.courseId,
    });
  });
});

// FR-006: marking a lesson as a free preview opens it only through the
// freePreview router. Every enrolled procedure refuses exactly as above when
// the lesson it names is an open preview of this priced course. These fail if
// requireEnrolment is ever taught about previews.
describe('content of an open preview lesson in a priced published course', () => {
  beforeEach(() => {
    db.module = {
      courseId: ref.courseId,
      moduleId: ref.moduleId,
      visibility: 'visible',
    };
    db.lesson = {
      courseId: ref.courseId,
      moduleId: ref.moduleId,
      lessonId: ref.lessonId,
      kind: 'lesson',
      visibility: 'visible',
      freePreview: true,
    };
    db.contentItem = {
      ...ref,
      type: 'video',
      status: 'ready',
      visibility: 'visible',
      s3Key: 'courses/course-1/video/n1/master.m3u8',
    };
  });

  it.each(Object.entries(calls))(
    '%s is FORBIDDEN for a student with no enrolment',
    async (_name, call) => {
      await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  );

  it.each(Object.entries(calls))(
    '%s is FORBIDDEN for a student whose enrolment was dropped',
    async (_name, call) => {
      db.enrolment = { ...enrolment, status: 'dropped' };
      await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  );
});
