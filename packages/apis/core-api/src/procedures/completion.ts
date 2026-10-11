/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { isShown } from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseProcedure } from '../init.js';
import {
  type CancellationReasons,
  hasTransactionConflict,
  transactionConflict,
} from '../lib/transaction.js';
import {
  CompleteContentItemInputSchema,
  CompleteContentItemOutputSchema,
  type IItemCompletion,
  type IQuizSettings,
  MyCompletionsInputSchema,
  MyCompletionsOutputSchema,
} from '../schema/index.js';
import { getEnrolment, requireEnrolment } from './enrolment.js';
import { attemptsRemain } from './quiz.js';

// A completion that lost a race (another request completing the same item, an
// instructor's change, or a concurrent transaction) is re-read this many times
// before giving up with CONFLICT.
const MAX_COMPLETE_TRIES = 3;

const asCompletion = (record: IItemCompletion): IItemCompletion => ({
  courseId: record.courseId,
  moduleId: record.moduleId,
  lessonId: record.lessonId,
  contentItemId: record.contentItemId,
  completedAt: record.completedAt,
});

// Records that the caller has completed a content item, once. The client
// decides when a text or video item is done (scrolled past, watched to near
// the end); core-api decides whether it counts. One transaction checks that:
// - the course is still published (an archived course is read-only),
// - the module, lesson and item are still visible and not archived,
// - the student is still enrolled,
// and creates the completion only if there isn't one. For a text or video
// item that is the student's first record of it, so the same transaction
// increments the item's studentActivityCount: each student is counted once.
// A quiz completes itself when an attempt passes or uses the last attempt
// (see quiz.submitAttempt); it's accepted here only once that holds, which
// covers an attempt limit lowered below what the student has already used.
// Completing again returns the existing completion.
export const completeContentItem = courseProcedure
  .input(CompleteContentItemInputSchema)
  .output(CompleteContentItemOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const userId = ctx.user.sub;
    const { courseId, moduleId, lessonId, contentItemId } = input;
    const itemKey = { courseId, moduleId, lessonId, contentItemId };
    const completionKey = { userId, courseId, lessonId, contentItemId };

    for (let tries = 0; tries < MAX_COMPLETE_TRIES; tries++) {
      const [
        { data: course },
        { data: module },
        { data: lesson },
        { data: item },
        enrolment,
        { data: completion },
        { data: summary },
      ] = await Promise.all([
        coreTable.entities.course.get({ courseId }).go(),
        coreTable.entities.module.get({ courseId, moduleId }).go(),
        coreTable.entities.lesson.get({ courseId, moduleId, lessonId }).go(),
        coreTable.entities.contentItem.get(itemKey).go(),
        getEnrolment(coreTable, courseId, userId),
        coreTable.entities.itemCompletion.get(completionKey).go(),
        coreTable.entities.quizSummary
          .get({ userId, courseId, contentItemId })
          .go(),
      ]);
      if (!course) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      requireEnrolment(course, enrolment);
      if (
        !module ||
        !lesson ||
        !item ||
        !isShown(module) ||
        !isShown(lesson) ||
        !isShown(item)
      ) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'This item is no longer available',
        });
      }
      if (completion) {
        return asCompletion(completion);
      }
      if (course.status !== 'published') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This course is archived, so nothing in it can be completed',
        });
      }
      const isQuiz = item.type === 'quiz';
      if (isQuiz) {
        // contentItem's quiz attributes are typed `any` by ElectroDB;
        // instructor-api validated their shapes when the quiz was saved.
        const settings = item.settings as IQuizSettings;
        if (
          !summary ||
          (!summary.passedAt && attemptsRemain(settings, summary.attemptsUsed))
        ) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Pass the quiz, or use all its attempts, to complete it',
          });
        }
      }

      const completedAt = new Date().toISOString();
      const { canceled, data } = await coreTable.transaction
        .write(
          ({
            course,
            module,
            lesson,
            contentItem,
            enrolment,
            itemCompletion,
          }) => [
            course
              .check({ courseId })
              .where((attr, op) => op.eq(attr.status, 'published'))
              .commit(),
            module
              .check({ courseId, moduleId })
              .where(
                (attr, op) =>
                  `${op.eq(attr.visibility, 'visible')} AND ${op.notExists(attr.archivedAt)}`,
              )
              .commit(),
            lesson
              .check({ courseId, moduleId, lessonId })
              .where(
                (attr, op) =>
                  `${op.eq(attr.visibility, 'visible')} AND ${op.notExists(attr.archivedAt)}`,
              )
              .commit(),
            isQuiz
              ? // The quiz still has the settings eligibility was judged
                // against; its activity was counted by the first attempt.
                contentItem
                  .check(itemKey)
                  .where(
                    (attr, op) =>
                      `${op.eq(attr.visibility, 'visible')} AND ${op.notExists(attr.archivedAt)} AND ${op.eq(attr.quizVersion, item.quizVersion)}`,
                  )
                  .commit()
              : contentItem
                  .update(itemKey)
                  .add({ studentActivityCount: 1 })
                  .where(
                    (attr, op) =>
                      `${op.eq(attr.visibility, 'visible')} AND ${op.notExists(attr.archivedAt)}`,
                  )
                  .commit(),
            enrolment
              .check({ courseId, userId })
              .where(
                (attr, op) =>
                  `${op.exists(attr.userId)} AND ${op.ne(attr.status, 'dropped')}`,
              )
              .commit(),
            itemCompletion
              .create({ ...completionKey, moduleId, completedAt })
              .commit(),
          ],
        )
        .go();

      if (!canceled) {
        return { ...itemKey, completedAt };
      }
      // Something changed after it was read: the course, the item or its
      // ancestors, the enrolment, or the same item was completed at the same
      // moment. Nothing was written; read again, which returns the completion
      // that landed or gives the precise error.
      const reasons: CancellationReasons = data ?? [];
      if (
        !reasons.some((reason) => reason?.code === 'ConditionalCheckFailed') &&
        !hasTransactionConflict(reasons)
      ) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to record the completion',
        });
      }
    }
    throw transactionConflict();
  });

// Every item the caller has completed in a course, so the lesson player can
// mark them done. Completions of items since hidden or archived are included;
// the player shows only what course.view lists.
export const myCompletions = courseProcedure
  .input(MyCompletionsInputSchema)
  .output(MyCompletionsOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const userId = ctx.user.sub;
    const { courseId } = input;
    const [{ data: course }, enrolment] = await Promise.all([
      coreTable.entities.course.get({ courseId }).go(),
      getEnrolment(coreTable, courseId, userId),
    ]);
    if (!course) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    requireEnrolment(course, enrolment);

    // Every page: a long course can have more completions than one page holds.
    const { data } = await coreTable.entities.itemCompletion.query
      .primary({ userId, courseId })
      .go({ pages: 'all' });
    return { items: data.map(asCompletion) };
  });
