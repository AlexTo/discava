/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type createCoreTableService, isShown } from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { v7 as uuidv7 } from 'uuid';
import { courseProcedure } from '../init.js';
import {
  type CancellationReasons,
  hasTransactionConflict,
  transactionConflict,
} from '../lib/transaction.js';
import {
  type IQuizAnswerKey,
  type IQuizAnswers,
  type IQuizAttempt,
  type IQuizQuestion,
  type IQuizRef,
  type IQuizReveal,
  type IQuizSettings,
  type IQuizSummary,
  MyQuizAttemptsInputSchema,
  MyQuizAttemptsOutputSchema,
  SubmitQuizAttemptInputSchema,
  SubmitQuizAttemptOutputSchema,
  ViewQuizInputSchema,
  ViewQuizOutputSchema,
} from '../schema/index.js';
import { getEnrolment, requireEnrolment } from './enrolment.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

// A submission whose transaction lost a race (another attempt, an instructor's
// save, or a concurrent transaction) is re-read and regraded this many times
// before giving up with CONFLICT.
const MAX_SUBMIT_TRIES = 3;

const quizUnavailable = () =>
  new TRPCError({
    code: 'NOT_FOUND',
    message: 'This quiz is no longer available',
  });

// Reads a quiz for the caller: they must be enrolled (not dropped) in the
// course, and the quiz, its lesson and its module must all be visible and
// not archived. A quiz in an archived course can still be read, as the rest
// of the course can.
const loadQuiz = async (
  coreTable: CoreTable,
  ref: IQuizRef,
  userId: string,
) => {
  const { courseId, moduleId, lessonId, contentItemId } = ref;
  const [
    { data: course },
    { data: module },
    { data: lesson },
    { data: item },
    enrolment,
    { data: summary },
  ] = await Promise.all([
    coreTable.entities.course.get({ courseId }).go(),
    coreTable.entities.module.get({ courseId, moduleId }).go(),
    coreTable.entities.lesson.get({ courseId, moduleId, lessonId }).go(),
    coreTable.entities.contentItem.get(ref).go(),
    getEnrolment(coreTable, courseId, userId),
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
    item.type !== 'quiz' ||
    !isShown(module) ||
    !isShown(lesson) ||
    !isShown(item)
  ) {
    throw quizUnavailable();
  }

  // contentItem's quiz attributes are typed `any` by ElectroDB; instructor-api
  // validated their shapes when the quiz was saved.
  const quiz = {
    ...item,
    questions: item.questions as IQuizQuestion[],
    answerKey: item.answerKey as IQuizAnswerKey,
    settings: item.settings as IQuizSettings,
    quizVersion: item.quizVersion as number,
    questionsHash: item.questionsHash as string,
  };
  return { course, quiz, summary };
};

const attemptsRemain = (settings: IQuizSettings, attemptsUsed: number) =>
  settings.attemptsAllowed === null || attemptsUsed < settings.attemptsAllowed;

// The correct options and explanations, once the quiz's revealAnswers setting
// allows: after any attempt, or once no attempts remain (never, while
// attempts are unlimited).
const revealFor = (
  quiz: { settings: IQuizSettings; answerKey: IQuizAnswerKey },
  attemptsUsed: number,
): IQuizReveal | null => {
  const { revealAnswers } = quiz.settings;
  const revealed =
    attemptsUsed > 0 &&
    (revealAnswers === 'after_each_attempt' ||
      (revealAnswers === 'after_final_attempt' &&
        !attemptsRemain(quiz.settings, attemptsUsed)));
  if (!revealed) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(quiz.answerKey).map(
      ([questionId, { correctOptionIds, explanation }]) => [
        questionId,
        { correctOptionIds, explanation },
      ],
    ),
  );
};

const asSummary = (
  summary: Omit<IQuizSummary, 'attemptsAllowed'>,
  settings: IQuizSettings,
): IQuizSummary => ({
  attemptsUsed: summary.attemptsUsed,
  attemptsAllowed: settings.attemptsAllowed,
  bestScore: summary.bestScore,
  bestAttemptId: summary.bestAttemptId,
  passedAt: summary.passedAt,
});

// Every answered question must be one of the quiz's, with options from that
// question, none repeated, and at most one for single choice. The questions
// are the ones the student saw: the caller has already matched their hash.
const validateAnswers = (questions: IQuizQuestion[], answers: IQuizAnswers) => {
  const questionsById = new Map(
    questions.map((question) => [question.questionId, question]),
  );
  for (const [questionId, optionIds] of Object.entries(answers)) {
    const question = questionsById.get(questionId);
    if (!question) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Unknown question ${questionId}`,
      });
    }
    const options = new Set(question.options.map(({ optionId }) => optionId));
    if (
      new Set(optionIds).size !== optionIds.length ||
      optionIds.some((optionId) => !options.has(optionId)) ||
      (question.kind === 'single' && optionIds.length > 1)
    ) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Invalid answer to question ${questionId}`,
      });
    }
  }
};

// All-or-nothing per question: the selected options must be exactly the
// correct ones. The score is rounded down, so a student is never shown more
// than they scored, and `passed` is exactly score >= pass mark.
export const gradeAttempt = (
  questions: IQuizQuestion[],
  answerKey: IQuizAnswerKey,
  passMarkPercent: number,
  answers: IQuizAnswers,
) => {
  const correctQuestionIds = questions
    .filter(({ questionId }) => {
      const selected = answers[questionId] ?? [];
      const correct = new Set(answerKey[questionId]?.correctOptionIds ?? []);
      return (
        selected.length === correct.size &&
        selected.every((optionId) => correct.has(optionId))
      );
    })
    .map(({ questionId }) => questionId);
  const scorePercent = Math.floor(
    (correctQuestionIds.length * 100) / questions.length,
  );
  return {
    correctQuestionIds,
    scorePercent,
    passed: scorePercent >= passMarkPercent,
  };
};

// A quiz's questions and settings, without its answer key.
export const viewQuiz = courseProcedure
  .input(ViewQuizInputSchema)
  .output(ViewQuizOutputSchema)
  .query(async ({ ctx, input }) => {
    const { quiz } = await loadQuiz(ctx.coreTable!, input, ctx.user.sub);
    return {
      courseId: quiz.courseId,
      moduleId: quiz.moduleId,
      lessonId: quiz.lessonId,
      contentItemId: quiz.contentItemId,
      title: quiz.title,
      description: quiz.description,
      order: quiz.order,
      questions: quiz.questions,
      settings: quiz.settings,
      quizVersion: quiz.quizVersion,
      questionsHash: quiz.questionsHash,
      createdAt: quiz.createdAt,
      updatedAt: quiz.updatedAt,
    };
  });

// Grades an attempt on the server and records it with the student's summary
// in one transaction, which also checks that:
// - the course is still published (an archived course is read-only),
// - the module, lesson and quiz are still visible and not archived,
// - the quiz is still the version it was graded against,
// - the student is still enrolled,
// - the summary still has the attemptsUsed it was read with, so two racing
//   submissions can't both use the last attempt.
// The first attempt creates the summary and increments the quiz's
// studentActivityCount in the same transaction, so each student is counted
// once.
export const submitQuizAttempt = courseProcedure
  .input(SubmitQuizAttemptInputSchema)
  .output(SubmitQuizAttemptOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const userId = ctx.user.sub;
    const { courseId, moduleId, lessonId, contentItemId, answers } = input;

    for (let tries = 0; tries < MAX_SUBMIT_TRIES; tries++) {
      const { course, quiz, summary } = await loadQuiz(
        coreTable,
        input,
        userId,
      );
      if (course.status !== 'published') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This course is archived, so its quizzes are closed',
        });
      }
      // The questions changed since the student loaded them. No attempt is
      // used: the client refetches the quiz and the student reviews it.
      if (quiz.questionsHash !== input.questionsHash) {
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            'This quiz was updated. Check the marked questions before submitting',
        });
      }
      const attemptsUsed = summary?.attemptsUsed ?? 0;
      if (!attemptsRemain(quiz.settings, attemptsUsed)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'No attempts remaining',
        });
      }
      validateAnswers(quiz.questions, answers);

      // Graded against the current key and pass mark: an edit that left the
      // questions alone doesn't interrupt the student.
      const { correctQuestionIds, scorePercent, passed } = gradeAttempt(
        quiz.questions,
        quiz.answerKey,
        quiz.settings.passMarkPercent,
        answers,
      );
      const attemptId = uuidv7();
      const submittedAt = new Date().toISOString();
      const attempt: IQuizAttempt = {
        attemptId,
        answers,
        correctQuestionIds,
        scorePercent,
        passed,
        quizVersion: quiz.quizVersion,
        questionsHash: quiz.questionsHash,
        submittedAt,
      };
      const improved = !summary || scorePercent > summary.bestScore;
      const nextSummary = {
        attemptsUsed: attemptsUsed + 1,
        bestScore: improved ? scorePercent : summary.bestScore,
        bestAttemptId: improved ? attemptId : summary.bestAttemptId,
        // A recorded pass is permanent.
        passedAt: summary?.passedAt ?? (passed ? submittedAt : undefined),
      };

      const itemKey = { courseId, moduleId, lessonId, contentItemId };
      const summaryKey = { userId, courseId, contentItemId };
      const { canceled, data } = await coreTable.transaction
        .write(
          ({
            course,
            module,
            lesson,
            contentItem,
            enrolment,
            quizSummary,
            quizAttempt,
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
            summary
              ? contentItem
                  .check(itemKey)
                  .where(
                    (attr, op) =>
                      `${op.eq(attr.visibility, 'visible')} AND ${op.notExists(attr.archivedAt)} AND ${op.eq(attr.quizVersion, quiz.quizVersion)}`,
                  )
                  .commit()
              : contentItem
                  .update(itemKey)
                  .add({ studentActivityCount: 1 })
                  .where(
                    (attr, op) =>
                      `${op.eq(attr.visibility, 'visible')} AND ${op.notExists(attr.archivedAt)} AND ${op.eq(attr.quizVersion, quiz.quizVersion)}`,
                  )
                  .commit(),
            enrolment
              .check({ courseId, userId })
              .where(
                (attr, op) =>
                  `${op.exists(attr.userId)} AND ${op.ne(attr.status, 'dropped')}`,
              )
              .commit(),
            summary
              ? quizSummary
                  .patch(summaryKey)
                  .set({
                    attemptsUsed: nextSummary.attemptsUsed,
                    bestScore: nextSummary.bestScore,
                    bestAttemptId: nextSummary.bestAttemptId,
                    ...(nextSummary.passedAt && {
                      passedAt: nextSummary.passedAt,
                    }),
                  })
                  .where((attr, op) =>
                    op.eq(attr.attemptsUsed, summary.attemptsUsed),
                  )
                  .commit()
              : quizSummary
                  .create({
                    ...summaryKey,
                    moduleId,
                    lessonId,
                    ...nextSummary,
                  })
                  .commit(),
            quizAttempt
              .create({
                userId,
                courseId,
                moduleId,
                lessonId,
                contentItemId,
                ...attempt,
              })
              .commit(),
          ],
        )
        .go();

      if (!canceled) {
        return {
          attempt,
          summary: asSummary(nextSummary, quiz.settings),
          reveal: revealFor(quiz, nextSummary.attemptsUsed),
        };
      }
      // Something changed after it was read: the course, the quiz or its
      // ancestors, the enrolment, or another attempt landed first. Nothing
      // was written; read again, which gives the precise error if the
      // submission is no longer allowed, or grades it against what's there
      // now.
      const reasons: CancellationReasons = data ?? [];
      if (
        !reasons.some((reason) => reason?.code === 'ConditionalCheckFailed') &&
        !hasTransactionConflict(reasons)
      ) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to submit the attempt',
        });
      }
    }
    throw transactionConflict();
  });

// The caller's summary and attempts for a quiz, oldest first, with the
// answers revealed once the quiz's settings allow.
export const myQuizAttempts = courseProcedure
  .input(MyQuizAttemptsInputSchema)
  .output(MyQuizAttemptsOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const userId = ctx.user.sub;
    const { quiz, summary } = await loadQuiz(coreTable, input, userId);

    // attemptIds are UUIDv7, so the sort key orders attempts by submission.
    const { data: attempts } = await coreTable.entities.quizAttempt.query
      .primary({
        userId,
        courseId: input.courseId,
        contentItemId: input.contentItemId,
      })
      .go({ pages: 'all' });

    return {
      summary: summary ? asSummary(summary, quiz.settings) : null,
      attempts: attempts.map((attempt) => ({
        attemptId: attempt.attemptId,
        answers: attempt.answers as IQuizAnswers,
        correctQuestionIds: attempt.correctQuestionIds,
        scorePercent: attempt.scorePercent,
        passed: attempt.passed,
        quizVersion: attempt.quizVersion,
        questionsHash: attempt.questionsHash,
        submittedAt: attempt.submittedAt,
      })),
      reveal: revealFor(quiz, summary?.attemptsUsed ?? 0),
    };
  });
