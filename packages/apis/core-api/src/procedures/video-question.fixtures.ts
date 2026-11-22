/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { vi } from 'vitest';
import {
  attr,
  cancelledWith,
  ops,
  prompt,
  type TransactionItem,
  transactionEntity,
} from './quiz.fixtures.js';

// What video-question-*.test.ts share: the mocked tables, a video with two
// questions and default mock behaviour. Imports no procedure, so a test can
// hoist its spies above the procedure imports.

export { attr, cancelledWith, ops, type TransactionItem, transactionEntity };

export const spies = {
  db: {} as Record<string, any>,
  transactionGo: vi.fn(),
};
export const { db, transactionGo } = spies;

const stored = (name: string) => ({
  get: vi.fn(() => ({
    go: vi.fn(async () => ({ data: db[name] ?? null })),
  })),
});

export const entities = {
  course: stored('course'),
  module: stored('module'),
  lesson: stored('lesson'),
  contentItem: stored('contentItem'),
  enrolment: stored('enrolment'),
  itemCompletion: stored('itemCompletion'),
  videoAnswerSheet: stored('videoAnswerSheet'),
};

export const TRANSACTION_ENTITIES = [
  'course',
  'module',
  'lesson',
  'contentItem',
  'enrolment',
  'itemCompletion',
  'videoAnswerSheet',
];

export const transactions: TransactionItem[][] = [];

export const USER_SUB = 'student-1';

export const ref = {
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
  contentItemId: 'video-1',
};

export const MANIFEST =
  'courses/course-1/modules/module-1/lessons/lesson-1/content-items/video-1/nonce-1/master.m3u8';

export const SECRET_EXPLANATION = prompt(
  'Fargate runs containers serverlessly',
);

// q1 is single choice (b is right) at 0:10; q2 is multiple choice (a and c are)
// at the end.
export const videoItem = {
  ...ref,
  type: 'video' as const,
  status: 'ready' as const,
  s3Key: MANIFEST,
  title: 'Containers',
  order: 1,
  visibility: 'visible' as const,
  studentActivityCount: 0,
  questions: [
    {
      questionId: 'q1',
      kind: 'single',
      prompt: prompt('Which service runs containers without servers?'),
      options: [
        { optionId: 'a', text: 'EC2' },
        { optionId: 'b', text: 'Fargate' },
      ],
      atSeconds: 10,
      contentHash: 'hash-q1',
    },
    {
      questionId: 'q2',
      kind: 'multiple',
      prompt: prompt('Which are serverless?'),
      options: [
        { optionId: 'a', text: 'Lambda' },
        { optionId: 'b', text: 'EC2' },
        { optionId: 'c', text: 'Fargate' },
      ],
      atSeconds: null,
      contentHash: 'hash-q2',
    },
  ],
  answerKey: {
    q1: { correctOptionIds: ['b'], explanation: SECRET_EXPLANATION },
    q2: { correctOptionIds: ['a', 'c'] },
  },
  quizVersion: 3,
};

export const existingSheet = (
  answers: Record<string, unknown>,
  answerCount = Object.keys(answers).length,
) => {
  db.videoAnswerSheet = {
    userId: USER_SUB,
    courseId: 'course-1',
    contentItemId: 'video-1',
    moduleId: 'module-1',
    lessonId: 'lesson-1',
    answers,
    answerCount,
  };
};

export const entry = (over: Record<string, unknown> = {}) => ({
  optionIds: ['a'],
  correct: false,
  answeredAt: '2024-01-03T00:00:00.000Z',
  quizVersion: 3,
  ...over,
});

export const installDefaults = () => {
  vi.clearAllMocks();
  transactions.length = 0;
  for (const key of Object.keys(db)) {
    delete db[key];
  }
  db.course = { courseId: 'course-1', title: 'AWS', status: 'published' };
  db.module = { ...ref, visibility: 'visible' };
  db.lesson = { ...ref, visibility: 'visible' };
  db.contentItem = videoItem;
  db.enrolment = {
    courseId: 'course-1',
    userId: USER_SUB,
    status: 'active',
    progressPercent: 0,
    createdAt: '2024-01-02T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  };
  transactionGo.mockResolvedValue({ canceled: false, data: [] });
};
