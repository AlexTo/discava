/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { TRPCError } from '@trpc/server';
import { writeUnderActiveAncestors } from '../helpers/ancestor-writes.js';
import { asContentItemOutput } from '../helpers/content-item.js';
import {
  requireAncestorsNotArchived,
  requireNotArchived,
} from '../helpers/curriculum-guards.js';
import { hashQuizQuestions } from '../helpers/quiz-hash.js';
import { courseInstructorProcedure } from '../init.js';
import {
  type IUpdateVideoQuestionsOutput,
  type IVideoQuestion,
  type IVideoQuestionInput,
  UpdateVideoQuestionsInputSchema,
  UpdateVideoQuestionsOutputSchema,
} from '../schema/index.js';

// Timed questions by moment, keeping the sent order for equal moments (the
// sort is stable), then the end questions in the sent order.
const inAskingOrder = (questions: IVideoQuestionInput[]) =>
  [...questions].sort(
    (a, b) =>
      (a.atSeconds ?? Number.POSITIVE_INFINITY) -
        (b.atSeconds ?? Number.POSITIVE_INFINITY) || 0,
  );

const withContentHash = ({
  questionId,
  kind,
  prompt,
  options,
  atSeconds,
}: IVideoQuestionInput): IVideoQuestion => ({
  questionId,
  kind,
  prompt,
  options,
  atSeconds,
  contentHash: hashQuizQuestions([{ questionId, kind, prompt, options }]),
});

export const updateContentItemVideoQuestions = courseInstructorProcedure(
  UpdateVideoQuestionsInputSchema,
)
  .output(UpdateVideoQuestionsOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const {
      courseId,
      moduleId,
      lessonId,
      contentItemId,
      quizVersion,
      questions,
      answerKey,
    } = input;

    const key = { courseId, moduleId, lessonId, contentItemId };
    const { data: existing } = await coreTable.entities.contentItem
      .get(key)
      .go();
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    if (existing.type !== 'video') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Content item is type '${existing.type}', not 'video'`,
      });
    }
    requireNotArchived(existing, 'Restore the content item before editing it');
    await requireAncestorsNotArchived(coreTable, {
      courseId,
      moduleId,
      lessonId,
    });

    const staleVersion = () =>
      new TRPCError({
        code: 'CONFLICT',
        message:
          'The questions were modified by another request; reload them and retry',
      });
    if ((existing.quizVersion ?? 0) !== quizVersion) {
      throw staleVersion();
    }

    // One transaction: the module and lesson still active, the item itself
    // not archived, and its questions still at the version the editor
    // loaded, so of two saves from one version exactly one lands.
    await writeUnderActiveAncestors(
      coreTable,
      key,
      (entities) => [
        entities.contentItem
          .patch(key)
          .set({
            questions: inAskingOrder(questions).map(withContentHash),
            answerKey,
            quizVersion: quizVersion + 1,
          })
          .where((attr, op) =>
            quizVersion === 0
              ? `${op.notExists(attr.archivedAt)} AND ${op.notExists(attr.quizVersion)}`
              : `${op.notExists(attr.archivedAt)} AND ${op.eq(attr.quizVersion, quizVersion)}`,
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
    return asContentItemOutput<IUpdateVideoQuestionsOutput>(contentItem);
  });
