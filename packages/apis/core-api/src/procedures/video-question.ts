/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { playableManifest } from '@discava/common-server-utils/media-keys';
import { transactionConflict } from '@discava/common-server-utils/trpc-api-base';
import {
  type CoreTable,
  cancellationReasons,
  hasFailedCondition,
  hasTransactionConflict,
  isShown,
  type StoredVideoAnswerKey,
  type StoredVideoQuestion,
  studentActivityAt,
  type VideoAnswerEntry,
  videoAnswerWrites,
  videoQuestionsOf,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseProcedure } from '../init.js';
import {
  AnswerVideoQuestionInputSchema,
  AnswerVideoQuestionOutputSchema,
  type IAnswerVideoQuestionOutput,
  type IContentItemRef,
  type IViewVideoQuestionsOutput,
  ViewVideoQuestionsInputSchema,
  ViewVideoQuestionsOutputSchema,
} from '../schema/index.js';
import { getEnrolment, requireEnrolment } from './enrolment.js';

// An answer whose transaction lost a race (another tab's answer, an
// instructor's save, a completion) is re-read and judged again this many
// times before giving up with CONFLICT.
const MAX_ANSWER_TRIES = 3;

// Reads what a video's questions procedures need and applies the access rule
// of contentItem.videoUrl: an enrolment that isn't dropped, and a video that
// is shown (with its lesson and module) and playable.
const loadVideo = async (
  coreTable: CoreTable,
  ref: IContentItemRef,
  userId: string,
) => {
  const { courseId, moduleId, lessonId, contentItemId } = ref;
  const [
    { data: course },
    { data: module },
    { data: lesson },
    { data: item },
    enrolment,
    { data: sheet },
    { data: completion },
  ] = await Promise.all([
    coreTable.entities.course.get({ courseId }).go(),
    coreTable.entities.module.get({ courseId, moduleId }).go(),
    coreTable.entities.lesson.get({ courseId, moduleId, lessonId }).go(),
    coreTable.entities.contentItem
      .get({ courseId, moduleId, lessonId, contentItemId })
      .go(),
    getEnrolment(coreTable, courseId, userId),
    coreTable.entities.videoAnswerSheet
      .get({ userId, courseId, contentItemId })
      .go(),
    coreTable.entities.itemCompletion
      .get({ userId, courseId, lessonId, contentItemId })
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
    !isShown(item) ||
    item.type !== 'video' ||
    !playableManifest(item)
  ) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'This video is not available',
    });
  }
  return {
    course,
    enrolment: enrolment!,
    sheet,
    completion,
    ...videoQuestionsOf(item),
  };
};

const optionKind = (question: StoredVideoQuestion) =>
  question.kind === 'multiple' ? 'multiple' : 'single';

// The caller's recorded answer with the current key for its question: the
// recorded result stays, the correct options and explanation are today's.
const withKey = (
  entry: VideoAnswerEntry,
  answerKey: StoredVideoAnswerKey,
  questionId: string,
) => {
  const { correctOptionIds = [], explanation } = answerKey[questionId] ?? {};
  return {
    optionIds: entry.optionIds,
    correct: entry.correct,
    answeredAt: entry.answeredAt,
    correctOptionIds,
    ...(explanation && { explanation }),
  };
};

// All-or-nothing: the chosen options are exactly the correct ones.
const isCorrect = (optionIds: string[], correctOptionIds: string[]) => {
  const correct = new Set(correctOptionIds);
  return (
    optionIds.length === correct.size &&
    optionIds.every((optionId) => correct.has(optionId))
  );
};

// A video's questions without the answer key, and the caller's answers to
// them. Questions are only asked where answers can be recorded, so an
// archived course gives none.
export const viewVideoQuestions = courseProcedure
  .input(ViewVideoQuestionsInputSchema)
  .output(ViewVideoQuestionsOutputSchema)
  .query(async ({ ctx, input }): Promise<IViewVideoQuestionsOutput> => {
    const { course, sheet, questions, answerKey, quizVersion } =
      await loadVideo(ctx.coreTable, input, ctx.user.sub);
    if (course.status !== 'published' || questions.length === 0) {
      return { quizVersion: 0, questions: [], answers: {} };
    }
    const recorded = (sheet?.answers ?? {}) as Record<string, VideoAnswerEntry>;
    return {
      quizVersion,
      questions: questions.map(
        ({ questionId, prompt, options, atSeconds, contentHash, ...rest }) => ({
          questionId,
          kind: optionKind(rest as StoredVideoQuestion),
          prompt,
          options: options.map(({ optionId, text }) => ({ optionId, text })),
          atSeconds,
          contentHash,
        }),
      ),
      answers: Object.fromEntries(
        questions
          .filter(({ questionId }) => recorded[questionId])
          .map(({ questionId }) => [
            questionId,
            withKey(recorded[questionId]!, answerKey, questionId),
          ]),
      ),
    };
  });

// Records the caller's one answer to a question, graded on the server. It
// writes the learner's answer sheet (and counts them on the video the first
// time) and nothing else: no completion, progress, quiz or certificate.
export const answerVideoQuestion = courseProcedure
  .input(AnswerVideoQuestionInputSchema)
  .output(AnswerVideoQuestionOutputSchema)
  .mutation(async ({ ctx, input }): Promise<IAnswerVideoQuestionOutput> => {
    const coreTable = ctx.coreTable;
    const userId = ctx.user.sub;
    const { courseId, moduleId, lessonId, contentItemId, questionId } = input;

    for (let tries = 0; tries < MAX_ANSWER_TRIES; tries++) {
      const {
        course,
        enrolment,
        sheet,
        completion,
        questions,
        answerKey,
        quizVersion,
      } = await loadVideo(coreTable, input, userId);
      if (course.status !== 'published') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This course is archived, so its questions are closed',
        });
      }
      const question = questions.find((q) => q.questionId === questionId);
      if (!question) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'This question is no longer part of the video',
        });
      }
      const recorded = (sheet?.answers ?? {}) as Record<
        string,
        VideoAnswerEntry
      >;
      // Before the hash check, so a retry after an edit returns the record.
      if (recorded[questionId]) {
        return {
          ...withKey(recorded[questionId], answerKey, questionId),
          recorded: false,
        };
      }
      if (question.contentHash !== input.contentHash) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This question was updated. Check it before answering',
        });
      }
      const { optionIds } = input;
      const validOptions = new Set(
        question.options.map(({ optionId }) => optionId),
      );
      if (
        new Set(optionIds).size !== optionIds.length ||
        optionIds.some((optionId) => !validOptions.has(optionId)) ||
        (optionKind(question) === 'single' && optionIds.length > 1)
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Invalid answer to question ${questionId}`,
        });
      }

      // Graded against the current key: an edit that left the question
      // alone doesn't interrupt the learner.
      const { correctOptionIds = [], explanation } =
        answerKey[questionId] ?? {};
      const entry: VideoAnswerEntry = {
        optionIds,
        correct: isCorrect(optionIds, correctOptionIds),
        answeredAt: studentActivityAt(enrolment),
        quizVersion,
      };

      const { canceled, data } = await coreTable.transaction
        .write((entities) =>
          videoAnswerWrites(entities, {
            userId,
            courseId,
            moduleId,
            lessonId,
            contentItemId,
            questionId,
            entry,
            sheet: sheet
              ? {
                  answers: recorded,
                  answerCount: sheet.answerCount,
                }
              : undefined,
            completed: Boolean(completion),
          }),
        )
        .go();
      if (!canceled) {
        return {
          optionIds,
          correct: entry.correct,
          answeredAt: entry.answeredAt,
          correctOptionIds,
          ...(explanation && { explanation }),
          recorded: true,
        };
      }
      // Something changed after it was read. Nothing was written; read again,
      // which gives the precise error, finds the answer another tab recorded,
      // or judges this one against what is there now.
      const reasons = cancellationReasons(data);
      if (!hasFailedCondition(reasons) && !hasTransactionConflict(reasons)) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to record the answer',
        });
      }
    }
    throw transactionConflict();
  });
