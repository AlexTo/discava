/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { TRPCError } from '@trpc/server';
import { v7 as uuidv7 } from 'uuid';
import { courseProcedure } from '../init.js';
import {
  getCourseOrThrow,
  initialVisibilityFields,
  requireAncestorsNotArchived,
  requireCourseInstructor,
  requireCourseNotArchived,
  requireNotArchived,
  writeAtEnd,
  writeUnderActiveAncestors,
} from '../lib/course-lifecycle.js';
import { hashQuizQuestions } from '../lib/quiz-hash.js';
import type { ICoreTableContext } from '../middleware/core-table.js';
import {
  CreateQuizAssignmentInputSchema,
  CreateQuizAssignmentOutputSchema,
  CreateUploadAssignmentInputSchema,
  CreateUploadAssignmentOutputSchema,
  type IUpdateContentItemAssignmentOutput,
  UpdateContentItemAssignmentInputSchema,
  UpdateContentItemAssignmentOutputSchema,
} from '../schema/index.js';
import { asContentItemOutput } from './content-item-shared.js';

// Assignments (#102): a lesson of kind 'assignment' in a module's outline,
// holding one content item. The lesson and its item are written together in
// one transaction, and the item can't be added to, removed or archived
// separately (see requireOrdinaryLesson and the delete guards in
// content-item-shared.ts), so an assignment lesson always has exactly one.

type CoreTable = NonNullable<ICoreTableContext['coreTable']>;

// What the item holds beyond the keys, title and order every item has.
type ItemAttributes =
  | {
      type: 'quiz';
      questions: unknown;
      answerKey: unknown;
      settings: unknown;
      quizVersion: number;
      questionsHash: string;
    }
  | {
      type: 'assignment';
      body: string;
      dueAt?: string;
      maxPoints: number;
    };

const createAssignmentLesson = async (
  coreTable: CoreTable,
  userId: string,
  {
    courseId,
    moduleId,
    title,
    description,
  }: {
    courseId: string;
    moduleId: string;
    title: string;
    description?: string;
  },
  item: ItemAttributes,
) => {
  await requireCourseInstructor(coreTable, courseId, userId);
  const course = await getCourseOrThrow(coreTable, courseId);
  requireCourseNotArchived(course);
  const { data: module } = await coreTable.entities.module
    .get({ courseId, moduleId })
    .go();
  if (!module) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
  requireNotArchived(
    module,
    'Restore the module before adding assignments to it',
  );

  const lessonId = uuidv7();
  const contentItemId = uuidv7();
  // Appended to the module, with its one item, in the same transaction as a
  // check that the module is still there and not archived. The item takes
  // order 1 of its lesson, so the lesson's lastChildOrder starts there.
  await writeAtEnd(coreTable, { courseId, moduleId }, (entities, order) => [
    entities.lesson
      .create({
        lessonId,
        moduleId,
        courseId,
        kind: 'assignment',
        title,
        description,
        order,
        lastChildOrder: 1,
        ...initialVisibilityFields(course),
      })
      .commit(),
    entities.contentItem
      .create({
        contentItemId,
        lessonId,
        moduleId,
        courseId,
        title,
        description,
        ...item,
        order: 1,
        ...initialVisibilityFields(course),
      })
      .commit(),
  ]);

  // Transactions don't return the written attributes.
  const { data: lesson } = await coreTable.entities.lesson
    .get({ courseId, moduleId, lessonId })
    .go();
  if (!lesson) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
  }
  return lesson;
};

export const createQuizAssignment = courseProcedure
  .input(CreateQuizAssignmentInputSchema)
  .output(CreateQuizAssignmentOutputSchema)
  .mutation(({ ctx, input }) => {
    const { questions, answerKey, settings, ...target } = input;
    return createAssignmentLesson(ctx.coreTable!, ctx.user.sub, target, {
      type: 'quiz',
      questions,
      answerKey,
      settings,
      quizVersion: 1,
      questionsHash: hashQuizQuestions(questions),
    });
  });

export const createUploadAssignment = courseProcedure
  .input(CreateUploadAssignmentInputSchema)
  .output(CreateUploadAssignmentOutputSchema)
  .mutation(({ ctx, input }) => {
    const { body, dueAt, maxPoints, ...target } = input;
    return createAssignmentLesson(ctx.coreTable!, ctx.user.sub, target, {
      type: 'assignment',
      body,
      dueAt,
      maxPoints,
    });
  });

// Edits an upload assignment's instructions, due date and points. A quiz
// assignment is edited with contentItem.updateQuiz, and its title with
// lesson.update.
export const updateContentItemAssignment = courseProcedure
  .input(UpdateContentItemAssignmentInputSchema)
  .output(UpdateContentItemAssignmentOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { body, dueAt, maxPoints, ...key } = input;
    const { courseId, moduleId, lessonId } = key;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
    const { data: existing } = await coreTable.entities.contentItem
      .get(key)
      .go();
    if (!existing || existing.type !== 'assignment') {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    requireNotArchived(existing, 'Restore the assignment before editing it');
    await requireAncestorsNotArchived(coreTable, {
      courseId,
      moduleId,
      lessonId,
    });
    if (body === undefined && dueAt === undefined && maxPoints === undefined) {
      return asContentItemOutput<IUpdateContentItemAssignmentOutput>(existing);
    }

    await writeUnderActiveAncestors(
      coreTable,
      key,
      (entities) => {
        const patch = entities.contentItem.patch(key).set({
          ...(body !== undefined && { body }),
          ...(typeof dueAt === 'string' && { dueAt }),
          ...(maxPoints !== undefined && { maxPoints }),
        });
        return [
          (dueAt === null ? patch.remove(['dueAt']) : patch)
            .where((attr, op) => op.notExists(attr.archivedAt))
            .commit(),
        ];
      },
      async () => {
        const { data: current } = await coreTable.entities.contentItem
          .get(key)
          .go();
        if (!current) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
        requireNotArchived(current, 'Restore the assignment before editing it');
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            'The assignment was changed by another request; please retry',
        });
      },
    );

    // Transactions don't return the written attributes.
    const { data: contentItem } = await coreTable.entities.contentItem
      .get(key)
      .go();
    return asContentItemOutput<IUpdateContentItemAssignmentOutput>(contentItem);
  });
