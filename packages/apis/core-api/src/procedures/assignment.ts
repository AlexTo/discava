/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import type { Logger } from '@aws-lambda-powertools/logger';
import {
  scheduleTranscodeCleanup,
  scheduleTranscodeCleanupOrThrow,
} from '@discava/common-server-utils/cleanup-scheduler';
import {
  copyLessonFileUploadTo,
  deleteLessonMediaFolder,
  headLessonFileUpload,
  isSubmissionUploadKey,
  LESSON_FILE_MAX_BYTES,
  LESSON_FILE_TYPES,
  lessonFileType,
  presignLessonFileUpload,
  submissionFileKey,
  submissionFolderNonce,
  submissionFolderPrefix,
  submissionNonceOf,
  submissionUploadKey,
} from '@discava/common-server-utils/lesson-files';
import { LOCAL_EVENT_RUNNER } from '@discava/common-server-utils/local-dev';
import {
  RETIRED_VERSION_DELAY_MINUTES,
  SUBMISSION_ATTEMPT_CLEANUP_DELAY_MINUTES,
} from '@discava/common-server-utils/media-keys';
import {
  assignmentSubmissionWrites,
  type createCoreTableService,
  isLateSubmission,
  isShown,
  studentActivityAt,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseProcedure } from '../init.js';
import {
  type CancellationReasons,
  hasTransactionConflict,
  transactionConflict,
} from '../lib/transaction.js';
import {
  type IAssignmentRef,
  type ISubmission,
  SubmitInputSchema,
  SubmitOutputSchema,
  UploadUrlInputSchema,
  UploadUrlOutputSchema,
} from '../schema/index.js';
import { getEnrolment, requireEnrolment } from './enrolment.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

// A submit that lost to a change it can't tell from a race (an unrelated
// write to the enrolment, say) reads again and tries this many times before
// giving up with CONFLICT.
const MAX_SUBMIT_TRIES = 3;

// How long the local event runner waits before an attempt's guard cleanup:
// longer than the submit function's timeout, unlike its default few seconds.
const LOCAL_ATTEMPT_GUARD_SECONDS = LOCAL_EVENT_RUNNER.cleanupDelaySeconds;

// What every procedure reads and checks first (contracts/core-api-assignment):
// the course exists and the caller is enrolled, and the module, lesson and
// item are shown and the item is an upload assignment. Then the caller's own
// submission and completion of it, found by key from the token.
const readAssignment = async (
  coreTable: CoreTable,
  userId: string,
  ref: IAssignmentRef,
) => {
  const { courseId, moduleId, lessonId, contentItemId } = ref;
  const [
    { data: course },
    { data: module },
    { data: lesson },
    { data: item },
    enrolment,
    { data: submission },
    { data: completion },
  ] = await Promise.all([
    coreTable.entities.course.get({ courseId }).go(),
    coreTable.entities.module.get({ courseId, moduleId }).go(),
    coreTable.entities.lesson.get({ courseId, moduleId, lessonId }).go(),
    coreTable.entities.contentItem.get(ref).go(),
    getEnrolment(coreTable, courseId, userId),
    coreTable.entities.assignmentSubmission
      .get({ courseId, contentItemId, userId })
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
    item.type !== 'assignment'
  ) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'This assignment is not available',
    });
  }
  return { course, item, enrolment: enrolment!, submission, completion };
};

type Read = Awaited<ReturnType<typeof readAssignment>>;

// Submitting needs a published course (an archived one is read-only) and a
// submission that hasn't been returned.
const requireOpenForSubmitting = ({ course, submission }: Read) => {
  if (course.status !== 'published') {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'This course is archived, so nothing can be submitted',
    });
  }
  if (submission?.status === 'returned') {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: "This submission has been returned and can't be changed",
    });
  }
};

const notAllowedType = (fileName: string) =>
  new TRPCError({
    code: 'BAD_REQUEST',
    message: `${fileName} can't be attached. Allowed types: ${Object.keys(LESSON_FILE_TYPES).join(', ')}`,
  });

// A presigned PUT for the one file of a submission, to the upload bucket.
// Nothing is recorded: the file is only used once `submit` is given its key.
export const uploadUrl = courseProcedure
  .input(UploadUrlInputSchema)
  .output(UploadUrlOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const userId = ctx.user.sub;
    const { fileName, fileSize, ...ref } = input;
    const read = await readAssignment(ctx.coreTable!, userId, ref);
    requireOpenForSubmitting(read);

    const mimeType = lessonFileType(fileName);
    if (!mimeType) {
      throw notAllowedType(fileName);
    }
    const objectKey = submissionUploadKey(ref, userId, randomUUID(), fileName);
    return {
      objectKey,
      ...(await presignLessonFileUpload(objectKey, mimeType, fileSize)),
    };
  });

// Checks the upload `objectKey` names, and returns what it is.
const validateUpload = async (
  ref: IAssignmentRef,
  userId: string,
  objectKey: string,
  fileName: string,
) => {
  const mimeType = lessonFileType(fileName);
  if (!mimeType) {
    throw notAllowedType(fileName);
  }
  if (!isSubmissionUploadKey(objectKey, ref, userId, fileName)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'That upload was not issued for this assignment',
    });
  }
  const upload = await headLessonFileUpload(objectKey);
  if (!upload) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The file was not uploaded',
    });
  }
  const { contentType, contentLength } = upload;
  if (contentType !== mimeType) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `The uploaded file is not a ${mimeType} file`,
    });
  }
  if (
    contentLength === undefined ||
    contentLength <= 0 ||
    contentLength > LESSON_FILE_MAX_BYTES
  ) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The uploaded file must be between 1 byte and 100 MB',
    });
  }
  return { mimeType, fileSize: contentLength };
};

// Records the caller's submission to an upload assignment: their one file,
// stored under a folder of its own. The request:
// 1. reads and checks everything, and the upload `uploadUrl` issued;
// 2. schedules a guard cleanup of its folder, before copying anything, so a
//    crash can't leave the copy behind (the guard never deletes a student's
//    current file);
// 3. copies the file once into that folder;
// 4. runs the write (see assignmentSubmissionWrites), up to MAX_SUBMIT_TRIES
//    times, each on a fresh read: a submission that appeared or moved on means
//    another request won, which is a CONFLICT -- exactly one of two racing
//    requests wins, and the other is told to retry;
// 5. deletes its folder whenever it ends without a committed record, and
//    after a resubmit schedules the retirement of the replaced folder.
export const submit = courseProcedure
  .input(SubmitInputSchema)
  .output(SubmitOutputSchema)
  .mutation(async ({ ctx, input }): Promise<ISubmission> => {
    const coreTable = ctx.coreTable!;
    const userId = ctx.user.sub;
    const logger = ctx.logger;
    const { objectKey, fileName, ...ref } = input;
    const { courseId, moduleId, lessonId, contentItemId } = ref;

    let read = await readAssignment(coreTable, userId, ref);
    requireOpenForSubmitting(read);
    const { mimeType, fileSize } = await validateUpload(
      ref,
      userId,
      objectKey,
      fileName,
    );

    const attemptId = randomUUID();
    const nonce = submissionFolderNonce(userId, attemptId);
    const folder = submissionFolderPrefix(ref, nonce);
    try {
      await scheduleTranscodeCleanupOrThrow(
        { courseId, moduleId, lessonId, contentItemId, submissionNonce: nonce },
        SUBMISSION_ATTEMPT_CLEANUP_DELAY_MINUTES,
        {
          keepIfCurrentFor: userId,
          purpose: 'attempt',
          localDelaySeconds: LOCAL_ATTEMPT_GUARD_SECONDS,
        },
      );
    } catch (error) {
      logger?.error('Failed to schedule a submission attempt guard', {
        error,
        folder,
      });
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Could not start the submission; please try again',
      });
    }

    let committed = false;
    try {
      const key = submissionFileKey(ref, userId, attemptId, fileName);
      await copyLessonFileUploadTo(objectKey, key, {
        contentType: mimeType,
        fileName,
      });
      const file = { key, fileName, fileSize, mimeType };

      for (let tries = 0; tries < MAX_SUBMIT_TRIES; tries++) {
        const { item, enrolment, submission, completion } = read;
        const at = studentActivityAt(enrolment);
        const dueAt = item.dueAt as string | undefined;
        const { canceled, data } = await coreTable.transaction
          .write((entities) =>
            assignmentSubmissionWrites(entities, {
              userId,
              ...ref,
              at,
              dueAt,
              file,
              existing: submission
                ? { version: submission.version }
                : undefined,
              hasCompletion: !!completion,
            }),
          )
          .go();

        if (!canceled) {
          committed = true;
          if (submission) {
            await retireReplacedFolder(
              logger,
              ref,
              userId,
              submission.file.key,
            );
          }
          return {
            version: (submission?.version ?? 0) + 1,
            status: 'submitted',
            submittedAt: at,
            late: isLateSubmission(at, dueAt),
            file: { fileName, fileSize, mimeType },
          };
        }

        const reasons: CancellationReasons = data ?? [];
        if (
          !reasons.some(
            (reason) => reason?.code === 'ConditionalCheckFailed',
          ) &&
          !hasTransactionConflict(reasons)
        ) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to record the submission',
          });
        }
        // Read again: the precise error if the assignment no longer takes a
        // submission, CONFLICT if another request submitted first, or retry
        // with the same copy when an unrelated write got in the way.
        const previous = read.submission;
        read = await readAssignment(coreTable, userId, ref);
        requireOpenForSubmitting(read);
        if (read.submission?.version !== previous?.version) {
          throw transactionConflict();
        }
      }
      throw transactionConflict();
    } finally {
      if (!committed) {
        await deleteLessonMediaFolder(logger, folder);
      }
    }
  });

// After a resubmit, schedules the end of the folder holding the replaced file.
// The cleanup never deletes a folder holding a student's current file, so a
// late or repeated run is harmless. Best-effort: failing only logs.
const retireReplacedFolder = async (
  logger: Logger | undefined,
  ref: IAssignmentRef,
  userId: string,
  replacedKey: string,
) => {
  const nonce = submissionNonceOf(replacedKey, ref, userId);
  if (!nonce) {
    return;
  }
  await scheduleTranscodeCleanup(
    logger,
    { ...ref, submissionNonce: nonce },
    RETIRED_VERSION_DELAY_MINUTES,
    { keepIfCurrentFor: userId, purpose: 'retire' },
  );
};
