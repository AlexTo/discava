/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getSignedCloudFrontFileUrl } from '@discava/common-server-utils/lesson-media';
import { transactionConflict } from '@discava/common-server-utils/trpc-api-base';
import {
  type AmendGradeWrite,
  amendGradeWrites,
  type CoreTable,
  cancellationReasons,
  defaultDisplayName,
  hasFailedCondition,
  hasTransactionConflict,
  isValidPoints,
  type RequestResubmissionWrite,
  type ReturnSubmissionWrite,
  requestResubmissionWrites,
  returnSubmissionWrites,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { v7 as uuidv7 } from 'uuid';
import { submissionList } from '../helpers/submission-list.js';
import { courseInstructorProcedure } from '../init.js';
import {
  AmendGradeInputSchema,
  GetSubmissionInputSchema,
  GetSubmissionOutputSchema,
  GradingWriteOutputSchema,
  type IFeedbackRound,
  type IGetSubmissionOutput,
  type IListSubmissionsOutput,
  ListSubmissionsInputSchema,
  ListSubmissionsOutputSchema,
  RequestResubmissionInputSchema,
  ReturnSubmissionInputSchema,
  SubmissionFileUrlInputSchema,
  SubmissionFileUrlOutputSchema,
} from '../schema/index.js';

// Grading an upload assignment's submissions (specs/20261120-230057-
// assignment-grading/contracts/instructor-api-assignment-submission.md).
// Every procedure is for an instructor of the course, and for an upload
// assignment (a content item of type 'assignment') in it; hidden or archived
// content is allowed. Writes go through core-table's grading helpers, which
// keep the submission, its round of feedback and the student's notification
// in one transaction.

const LEFT_COURSE =
  'This student has left the course. Their work can be read but not graded.';

const notFound = (message = 'This assignment was not found') =>
  new TRPCError({ code: 'NOT_FOUND', message });

// The assignment's content item, found by its id alone: the sort key starts
// with the module and lesson, which the caller doesn't send, so the course's
// items are read and filtered.
const readItem = async (
  coreTable: CoreTable,
  courseId: string,
  contentItemId: string,
) => {
  const { data: items } = await coreTable.entities.contentItem.query
    .primary({ courseId })
    .go({ pages: 'all' });
  const item = items.find(
    (candidate) =>
      candidate.contentItemId === contentItemId &&
      candidate.type === 'assignment',
  );
  if (!item) {
    throw notFound();
  }
  const { data: lesson } = await coreTable.entities.lesson
    .get({ courseId, moduleId: item.moduleId, lessonId: item.lessonId })
    .go();
  return {
    item,
    lessonId: item.lessonId,
    assignment: {
      title: lesson?.title ?? '',
      maxPoints: item.maxPoints ?? 0,
      ...(item.dueAt === undefined ? {} : { dueAt: item.dueAt }),
    },
  };
};

// Display names by user id, from one batch get.
const displayNames = async (coreTable: CoreTable, userIds: string[]) => {
  const distinct = [...new Set(userIds)];
  const names = new Map<string, string>();
  if (distinct.length === 0) {
    return names;
  }
  const { data: users } = await coreTable.entities.user
    .get(distinct.map((userId) => ({ userId })))
    .go();
  for (const user of users) {
    names.set(user.userId, defaultDisplayName(user));
  }
  return names;
};

const nameOf = (names: Map<string, string>, userId: string) =>
  names.get(userId) ?? defaultDisplayName();

const previewable = (mimeType: string): 'pdf' | 'image' | null =>
  mimeType === 'application/pdf'
    ? 'pdf'
    : ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mimeType)
      ? 'image'
      : null;

// The assignment's students and submissions, in the order of the contract:
// waiting work first. One page of 50.
export const listAssignmentSubmissions = courseInstructorProcedure(
  ListSubmissionsInputSchema,
)
  .output(ListSubmissionsOutputSchema)
  .query(async ({ ctx, input }): Promise<IListSubmissionsOutput> => {
    const coreTable = ctx.coreTable;
    const { courseId, contentItemId } = input;
    const { assignment } = await readItem(coreTable, courseId, contentItemId);

    const [{ data: enrolments }, { data: submissions }] = await Promise.all([
      coreTable.entities.enrolment.query
        .primary({ courseId })
        .go({ pages: 'all' }),
      coreTable.entities.assignmentSubmission.query
        .primary({ courseId, contentItemId })
        .go({ pages: 'all' }),
    ]);
    const { counts, rows, nextCursor } = submissionList(
      enrolments,
      submissions,
      input.cursor,
    );
    const names = await displayNames(
      coreTable,
      rows.map((row) => row.userId),
    );
    return {
      assignment,
      counts,
      rows: rows.map((row) => ({
        ...row,
        displayName: nameOf(names, row.userId),
      })),
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
  });

// One student's submission with its history of feedback, newest first.
export const getAssignmentSubmission = courseInstructorProcedure(
  GetSubmissionInputSchema,
)
  .output(GetSubmissionOutputSchema)
  .query(async ({ ctx, input }): Promise<IGetSubmissionOutput> => {
    const coreTable = ctx.coreTable;
    const { courseId, contentItemId, userId } = input;
    const { assignment } = await readItem(coreTable, courseId, contentItemId);

    const [{ data: enrolment }, { data: submission }, { data: rounds }] =
      await Promise.all([
        coreTable.entities.enrolment.get({ courseId, userId }).go(),
        coreTable.entities.assignmentSubmission
          .get({ courseId, contentItemId, userId })
          .go(),
        coreTable.entities.submissionFeedback.query
          .primary({ courseId, contentItemId, userId })
          .go({ order: 'desc', pages: 'all' }),
      ]);
    if (!enrolment && !submission) {
      throw notFound('This student was not found');
    }
    const names = await displayNames(coreTable, [
      userId,
      ...rounds.map((round) => round.givenBy),
    ]);

    return {
      assignment,
      student: {
        userId,
        displayName: nameOf(names, userId),
        enrolled: !!enrolment && enrolment.status !== 'dropped',
      },
      submission: submission
        ? {
            state: submission.status,
            version: submission.version,
            reviewRevision: submission.reviewRevision,
            submittedAt: submission.submittedAt,
            late: submission.late,
            file: {
              fileName: submission.file.fileName,
              fileSize: submission.file.fileSize,
              mimeType: submission.file.mimeType,
              previewable: previewable(submission.file.mimeType),
            },
            ...(submission.points === undefined
              ? {}
              : { points: submission.points }),
            ...(submission.pointsOutOf === undefined
              ? {}
              : { pointsOutOf: submission.pointsOutOf }),
            ...(submission.returnedAt === undefined
              ? {}
              : { returnedAt: submission.returnedAt }),
            ...(submission.gradedAt === undefined
              ? {}
              : { gradedAt: submission.gradedAt }),
          }
        : null,
      feedback: rounds.map(
        (round): IFeedbackRound => ({
          feedbackId: round.feedbackId,
          kind: round.kind,
          ...(round.feedback === undefined ? {} : { feedback: round.feedback }),
          ...(round.points === undefined ? {} : { points: round.points }),
          ...(round.pointsOutOf === undefined
            ? {}
            : { pointsOutOf: round.pointsOutOf }),
          version: round.version,
          givenAt: round.givenAt,
          givenBy: {
            userId: round.givenBy,
            displayName: nameOf(names, round.givenBy),
          },
        }),
      ),
    };
  });

// A short-lived link to the student's file, for the review page's download,
// PDF preview and image. A MediaUrl function: the only one of this router
// holding the CloudFront signing key. Local dev gets an S3Mock URL.
export const assignmentSubmissionFileUrl = courseInstructorProcedure(
  SubmissionFileUrlInputSchema,
)
  .output(SubmissionFileUrlOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const { courseId, contentItemId, userId } = input;
    await readItem(ctx.coreTable, courseId, contentItemId);
    const { data: submission } =
      await ctx.coreTable.entities.assignmentSubmission
        .get({ courseId, contentItemId, userId })
        .go();
    if (!submission) {
      throw notFound('There is no submission to download');
    }
    return { url: await getSignedCloudFrontFileUrl(submission.file.key) };
  });

type Action = 'return' | 'requestResubmission' | 'amendGrade';

interface GradingInput {
  courseId: string;
  contentItemId: string;
  userId: string;
  reviewRevision: number;
  version?: number;
  points?: number;
  feedback?: string;
}

type StoredSubmission = NonNullable<
  Awaited<ReturnType<typeof readSubmission>>['submission']
>;

const readSubmission = async (
  coreTable: CoreTable,
  { courseId, contentItemId, userId }: GradingInput,
) => {
  const [{ data: submission }, { data: enrolment }] = await Promise.all([
    coreTable.entities.assignmentSubmission
      .get({ courseId, contentItemId, userId })
      .go(),
    coreTable.entities.enrolment.get({ courseId, userId }).go(),
  ]);
  return { submission, enrolment };
};

// What a stale write names: the student resubmitted, or another instructor
// acted. Undefined when the submission is as the instructor read it.
const staleMessage = (
  action: Action,
  input: GradingInput,
  submission: StoredSubmission,
): string | undefined => {
  if (input.version !== undefined && submission.version !== input.version) {
    return 'The student submitted a newer version';
  }
  if (submission.reviewRevision === input.reviewRevision) {
    return undefined;
  }
  return action === 'amendGrade'
    ? 'The grade was changed by someone else'
    : action === 'requestResubmission'
      ? 'Another instructor already reviewed this'
      : 'Another instructor already returned this';
};

const stateAllowed = (action: Action, status: StoredSubmission['status']) =>
  action === 'return'
    ? status !== 'returned'
    : action === 'requestResubmission'
      ? status === 'submitted'
      : status === 'returned';

const wrongState = (action: Action, status: StoredSubmission['status']) =>
  new TRPCError({
    code: 'PRECONDITION_FAILED',
    message:
      action === 'amendGrade'
        ? 'Only a returned submission has a grade to change'
        : status === 'returned'
          ? 'This submission has already been returned'
          : 'A resubmission has already been requested',
  });

// The shared flow of return, requestResubmission and amendGrade:
// 1. read the item, lesson, course, submission and enrolment, and refuse a
//    student who left, points over the maximum, a stale version or revision,
//    and a state the action isn't allowed in;
// 2. run one transaction of the matching core-table writes;
// 3. when it is cancelled, read again and say what changed (CONFLICT).
const grade = async (
  coreTable: CoreTable,
  action: Action,
  instructorId: string,
  input: GradingInput,
): Promise<{ reviewRevision: number }> => {
  const { courseId, contentItemId, userId } = input;
  const [{ item, lessonId, assignment }, { data: course }, read] =
    await Promise.all([
      readItem(coreTable, courseId, contentItemId),
      coreTable.entities.course.get({ courseId }).go(),
      readSubmission(coreTable, input),
    ]);
  const { submission, enrolment } = read;
  if (!submission) {
    throw notFound('There is no submission to review');
  }
  if (!enrolment || enrolment.status === 'dropped') {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: LEFT_COURSE });
  }
  if (
    input.points !== undefined &&
    !isValidPoints(input.points, assignment.maxPoints)
  ) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Points must be between 0 and ${assignment.maxPoints}`,
    });
  }
  const stale = staleMessage(action, input, submission);
  if (stale) {
    throw new TRPCError({ code: 'CONFLICT', message: stale });
  }
  if (!stateAllowed(action, submission.status)) {
    throw wrongState(action, submission.status);
  }

  const common = {
    courseId,
    contentItemId,
    userId,
    feedbackId: uuidv7(),
    givenBy: instructorId,
    givenAt: new Date().toISOString(),
    lessonId,
    assignmentTitle: assignment.title,
    courseTitle: course?.title ?? '',
    version: submission.version,
    reviewRevision: input.reviewRevision,
    ...(input.feedback === undefined ? {} : { feedback: input.feedback }),
  };
  const items =
    action === 'return'
      ? await returnSubmissionWrites(coreTable, {
          ...common,
          points: input.points!,
          pointsOutOf: item.maxPoints ?? assignment.maxPoints,
        } satisfies ReturnSubmissionWrite)
      : action === 'amendGrade'
        ? await amendGradeWrites(coreTable, {
            ...common,
            points: input.points!,
            pointsOutOf: item.maxPoints ?? assignment.maxPoints,
          } satisfies AmendGradeWrite)
        : await requestResubmissionWrites(coreTable, {
            ...common,
            feedback: input.feedback!,
          } satisfies RequestResubmissionWrite);

  const { canceled, data } = await coreTable.transaction
    .write(() => items)
    .go();
  if (!canceled) {
    return { reviewRevision: input.reviewRevision + 1 };
  }

  const reasons = cancellationReasons(data);
  if (hasFailedCondition(reasons)) {
    const { submission: current } = await readSubmission(coreTable, input);
    throw new TRPCError({
      code: 'CONFLICT',
      message:
        (current && staleMessage(action, input, current)) ??
        'This submission changed; reload it and try again',
    });
  }
  if (hasTransactionConflict(reasons)) {
    throw transactionConflict();
  }
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Failed to record the review',
  });
};

// Returns a submitted or resubmission-requested submission as final, with
// points and optional feedback, and notifies the student.
export const returnAssignmentSubmission = courseInstructorProcedure(
  ReturnSubmissionInputSchema,
)
  .output(GradingWriteOutputSchema)
  .mutation(({ ctx, input }) =>
    grade(ctx.coreTable, 'return', ctx.user.sub, input),
  );

// Asks the student to resubmit, with feedback saying what to change.
export const requestAssignmentResubmission = courseInstructorProcedure(
  RequestResubmissionInputSchema,
)
  .output(GradingWriteOutputSchema)
  .mutation(({ ctx, input }) =>
    grade(ctx.coreTable, 'requestResubmission', ctx.user.sub, input),
  );

// Changes the grade of a returned submission; the first return's time and
// instructor stay.
export const amendAssignmentGrade = courseInstructorProcedure(
  AmendGradeInputSchema,
)
  .output(GradingWriteOutputSchema)
  .mutation(({ ctx, input }) =>
    grade(ctx.coreTable, 'amendGrade', ctx.user.sub, input),
  );
