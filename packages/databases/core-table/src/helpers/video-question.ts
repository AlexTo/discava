/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { createCoreTableService } from '../service.js';
import { studentActivityWrites } from './student-activity.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;
type TransactionWrites = Parameters<CoreTable['transaction']['write']>[0];
type TransactionEntities = Parameters<TransactionWrites>[0];

// Questions asked inside a video, and a learner's recorded answers to them.
// Two procedures keep one rule here (research R-5 of the in-video-questions
// spec): a learner's first record on a video, whichever comes first of the
// itemCompletion and the videoAnswerSheet, increments studentActivityCount
// once. Each writer, when it claims the first record, checks that the other
// record still doesn't exist, so a race cancels one transaction, which reads
// again and writes without the increment.

/** A question as stored on a video: `contentItem.questions`. */
export interface StoredVideoQuestion {
  questionId: string;
  kind: string;
  prompt: string;
  options: { optionId: string; text: string }[];
  /** Whole seconds into the video, or null for a question after it ends. */
  atSeconds: number | null;
  /** Set by instructor-api on save; changes only when the screen would. */
  contentHash: string;
}

/** The answer key as stored on a video: `contentItem.answerKey`. */
export type StoredVideoAnswerKey = Record<
  string,
  { correctOptionIds: string[]; explanation?: string }
>;

/** One entry of a sheet's `answers`. Added once, never changed. */
export interface VideoAnswerEntry {
  optionIds: string[];
  correct: boolean;
  answeredAt: string;
  quizVersion: number;
}

/**
 * A video's questions, answer key and version. The attributes are untyped on
 * the entity; an item without questions gives an empty list, an empty key
 * and version 0.
 */
export const videoQuestionsOf = (item: {
  questions?: unknown;
  answerKey?: unknown;
  quizVersion?: unknown;
}) => ({
  questions: (Array.isArray(item.questions)
    ? item.questions
    : []) as StoredVideoQuestion[],
  answerKey: (typeof item.answerKey === 'object' && item.answerKey !== null
    ? item.answerKey
    : {}) as StoredVideoAnswerKey,
  quizVersion: typeof item.quizVersion === 'number' ? item.quizVersion : 0,
});

export interface VideoRecordKey {
  userId: string;
  courseId: string;
  lessonId: string;
  contentItemId: string;
}

/**
 * A condition check that the other first record doesn't exist: the learner's
 * `completion` or `sheet` for the video.
 */
export const videoFirstRecordCheck = (
  { itemCompletion, videoAnswerSheet }: TransactionEntities,
  { userId, courseId, lessonId, contentItemId }: VideoRecordKey,
  other: 'completion' | 'sheet',
) =>
  other === 'completion'
    ? itemCompletion
        .check({ userId, courseId, lessonId, contentItemId })
        .where((attr, op) => op.notExists(attr.userId))
        .commit()
    : videoAnswerSheet
        .check({ userId, courseId, contentItemId })
        .where((attr, op) => op.notExists(attr.userId))
        .commit();

export interface VideoAnswer extends VideoRecordKey {
  moduleId: string;
  questionId: string;
  /** The entry to record; `at` for the activity is its `answeredAt`. */
  entry: VideoAnswerEntry;
  /** The learner's sheet as read, if they have one. */
  sheet?: {
    answers: Record<string, VideoAnswerEntry>;
    answerCount: number;
  };
  /** Whether the learner already has an itemCompletion for the video. */
  completed: boolean;
}

/**
 * The transaction items that record one answer: the student activity checks
 * (counting the learner when this is their first record on the video), the
 * sheet's create or patch, and, when this claims the first record, a check
 * that no completion has appeared. An entry already on the sheet is never
 * changed: the caller answers each question once.
 */
export const videoAnswerWrites = (
  entities: TransactionEntities,
  input: VideoAnswer,
): ReturnType<TransactionWrites> => {
  const {
    userId,
    courseId,
    moduleId,
    lessonId,
    contentItemId,
    questionId,
    entry,
    sheet,
    completed,
  } = input;
  if (sheet && questionId in sheet.answers) {
    throw new Error(`Question ${questionId} is already answered`);
  }
  const firstRecord = !sheet && !completed;
  const key = { userId, courseId, contentItemId };
  return [
    ...studentActivityWrites(entities, {
      userId,
      courseId,
      moduleId,
      lessonId,
      contentItemId,
      at: entry.answeredAt,
      firstRecord,
      quizVersion: entry.quizVersion,
    }),
    sheet
      ? entities.videoAnswerSheet
          .patch(key)
          .set({
            answers: { ...sheet.answers, [questionId]: entry },
            answerCount: sheet.answerCount + 1,
          })
          .where((attr, op) => op.eq(attr.answerCount, sheet.answerCount))
          .commit()
      : entities.videoAnswerSheet
          .create({
            ...key,
            moduleId,
            lessonId,
            answers: { [questionId]: entry },
            answerCount: 1,
          })
          .commit(),
    ...(firstRecord
      ? [videoFirstRecordCheck(entities, input, 'completion')]
      : []),
  ];
};
