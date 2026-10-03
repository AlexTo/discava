/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { TRPCError } from '@trpc/server';
import { v7 as uuidv7 } from 'uuid';
import { courseProcedure } from '../init.js';
import {
  getCourseOrThrow,
  initialVisibility,
  requireAncestorsNotArchived,
  requireCourseInstructor,
  requireNotArchived,
  writeUnderActiveAncestors,
} from '../lib/course-lifecycle.js';
import { hashQuizQuestions } from '../lib/quiz-hash.js';
import {
  CreateContentItemQuizInputSchema,
  CreateContentItemQuizOutputSchema,
  type ICreateContentItemQuizOutput,
  type IUpdateContentItemQuizOutput,
  UpdateContentItemQuizInputSchema,
  UpdateContentItemQuizOutputSchema,
} from '../schema/index.js';
import { asContentItemOutput } from './content-item-shared.js';

export const createContentItemQuiz = courseProcedure
  .input(CreateContentItemQuizInputSchema)
  .output(CreateContentItemQuizOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const {
      courseId,
      moduleId,
      lessonId,
      title,
      description,
      questions,
      answerKey,
      settings,
    } = input;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);

    const { data: lesson } = await coreTable.entities.lesson
      .get({ courseId, moduleId, lessonId })
      .go();
    if (!lesson) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    requireNotArchived(
      lesson,
      'Restore the lesson before adding content to it',
    );
    await requireAncestorsNotArchived(coreTable, { courseId, moduleId });
    const course = await getCourseOrThrow(coreTable, courseId);

    const contentItemId = uuidv7();

    // Appended to the end of the lesson, as text items are.
    const { data: contentItems } = await coreTable.entities.contentItem.query
      .primary({ courseId, moduleId, lessonId })
      .go();
    const order =
      contentItems.reduce((max, item) => Math.max(max, item.order), 0) + 1;

    // Created in the same transaction as checks that the module and lesson
    // are still there and not archived.
    const key = { courseId, moduleId, lessonId, contentItemId };
    await writeUnderActiveAncestors(coreTable, key, (entities) => [
      entities.contentItem
        .create({
          ...key,
          type: 'quiz',
          title,
          description,
          questions,
          answerKey,
          settings,
          quizVersion: 1,
          questionsHash: hashQuizQuestions(questions),
          order,
          visibility: initialVisibility(course),
        })
        .commit(),
    ]);

    // Transactions don't return the written attributes.
    const { data: contentItem } = await coreTable.entities.contentItem
      .get(key)
      .go();
    return asContentItemOutput<ICreateContentItemQuizOutput>(contentItem);
  });

export const updateContentItemQuiz = courseProcedure
  .input(UpdateContentItemQuizInputSchema)
  .output(UpdateContentItemQuizOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const {
      courseId,
      moduleId,
      lessonId,
      contentItemId,
      quizVersion,
      title,
      description,
      questions,
      answerKey,
      settings,
    } = input;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);

    const { data: existing } = await coreTable.entities.contentItem
      .get({ courseId, moduleId, lessonId, contentItemId })
      .go();
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    if (existing.type !== 'quiz') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Content item is type '${existing.type}', not 'quiz'`,
      });
    }
    requireNotArchived(existing, 'Restore the content item before editing it');
    await requireAncestorsNotArchived(coreTable, {
      courseId,
      moduleId,
      lessonId,
    });

    const key = { courseId, moduleId, lessonId, contentItemId };
    const staleVersion = () =>
      new TRPCError({
        code: 'CONFLICT',
        message:
          'The quiz was modified by another request; reload it and retry',
      });
    if (existing.quizVersion !== quizVersion) {
      throw staleVersion();
    }

    // One transaction: the module and lesson still active, the item itself
    // not archived, and the quiz still at the version the client loaded, so
    // a stale editor can't overwrite a newer save and `quizVersion` counts
    // every save exactly once.
    await writeUnderActiveAncestors(
      coreTable,
      key,
      (entities) => [
        entities.contentItem
          .patch(key)
          .set({
            ...(title !== undefined && { title }),
            ...(description !== undefined && { description }),
            questions,
            answerKey,
            settings,
            quizVersion: quizVersion + 1,
            questionsHash: hashQuizQuestions(questions),
          })
          .where(
            (attr, op) =>
              `${op.notExists(attr.archivedAt)} AND ${op.eq(attr.quizVersion, quizVersion)}`,
          )
          .commit(),
      ],
      async () => {
        const { data: current } = await coreTable.entities.contentItem
          .get(key)
          .go();
        if (!current) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
        requireNotArchived(
          current,
          'Restore the content item before editing it',
        );
        throw staleVersion();
      },
    );

    // Transactions don't return the written attributes.
    const { data: contentItem } = await coreTable.entities.contentItem
      .get(key)
      .go();
    return asContentItemOutput<IUpdateContentItemQuizOutput>(contentItem);
  });
