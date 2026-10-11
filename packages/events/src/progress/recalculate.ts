/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { createCoreTableService } from '@discava/core-table';
import { type Curriculum, computeProgress } from './progress.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

// A DynamoDB conditional write whose condition didn't hold, as opposed to
// any other failure.
const isConditionalCheckFailed = (error: unknown): boolean =>
  error instanceof Error &&
  'cause' in error &&
  error.cause instanceof Error &&
  error.cause.name === 'ConditionalCheckFailedException';

// A write that may lose to a completion recorded at the same moment by
// another run: that run's result stands, since completion is permanent.
const unlessAlreadyCompleted = async (write: () => Promise<unknown>) => {
  try {
    await write();
  } catch (error) {
    if (!isConditionalCheckFailed(error)) {
      throw error;
    }
  }
};

// The whole curriculum of a course, every page: a course's curriculum can
// exceed a single 1 MB query page.
export const loadCurriculum = async (
  coreTable: CoreTable,
  courseId: string,
): Promise<Curriculum> => {
  const { data } = await coreTable.collections
    .curriculum({ courseId })
    .go({ pages: 'all' });
  return {
    modules: data.module,
    lessons: data.lesson,
    contentItems: data.contentItem,
  };
};

// The students to recalculate when a course's curriculum changes: everyone
// enrolled who hasn't dropped out.
export const listEnrolledStudents = async (
  coreTable: CoreTable,
  courseId: string,
): Promise<string[]> => {
  const { data } = await coreTable.entities.enrolment.query
    .primary({ courseId })
    .go({ pages: 'all' });
  return data
    .filter(({ status }) => status !== 'dropped')
    .map(({ userId }) => userId);
};

// Recomputes one student's progress in a course from scratch and writes what
// changed: each lesson's progress, and the enrolment's progressPercent, with
// status 'completed' and completedAt at 100%. Completion is permanent: a
// lesson or course already completed is never written back to anything else,
// and the writes that complete them are conditioned on that, so a run racing
// another can't undo it. A student who isn't enrolled, or has dropped out,
// is left alone.
export const recalculateStudent = async (
  coreTable: CoreTable,
  courseId: string,
  curriculum: Curriculum,
  userId: string,
  now: string = new Date().toISOString(),
) => {
  const [{ data: enrolment }, { data: completions }, { data: existing }] =
    await Promise.all([
      coreTable.entities.enrolment.get({ courseId, userId }).go(),
      coreTable.entities.itemCompletion.query
        .primary({ userId, courseId })
        .go({ pages: 'all' }),
      coreTable.entities.progress.query
        .primary({ userId, courseId })
        .go({ pages: 'all' }),
    ]);
  if (!enrolment || enrolment.status === 'dropped') {
    return;
  }

  const result = computeProgress(
    curriculum,
    new Set(completions.map(({ contentItemId }) => contentItemId)),
  );

  const currentStatus = new Map(
    existing.map(({ lessonId, status }) => [lessonId, status]),
  );
  for (const { lessonId, status } of result.lessons) {
    // No record already means not started, so a lesson the student hasn't
    // touched isn't written.
    const current = currentStatus.get(lessonId) ?? 'not_started';
    if (current === 'completed' || current === status) {
      continue;
    }
    await unlessAlreadyCompleted(() =>
      coreTable.entities.progress
        .upsert({
          userId,
          courseId,
          lessonId,
          status,
          ...(status === 'completed' && { completedAt: now }),
        })
        .where(
          (attr, op) =>
            `${op.notExists(attr.status)} OR ${op.ne(attr.status, 'completed')}`,
        )
        .go(),
    );
  }

  if (enrolment.progressPercent !== result.progressPercent) {
    await unlessAlreadyCompleted(() =>
      coreTable.entities.enrolment
        .patch({ courseId, userId })
        .set({ progressPercent: result.progressPercent })
        .where((attr, op) => op.ne(attr.status, 'dropped'))
        .go(),
    );
  }
  if (result.completed && enrolment.status === 'active') {
    await unlessAlreadyCompleted(() =>
      coreTable.entities.enrolment
        .patch({ courseId, userId })
        .set({ status: 'completed', completedAt: now })
        .where((attr, op) => op.eq(attr.status, 'active'))
        .go(),
    );
  }
};
