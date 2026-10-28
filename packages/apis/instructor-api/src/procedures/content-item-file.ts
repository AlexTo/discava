/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import { getSignedCloudFrontFileUrl } from '@discava/common-server-utils/lesson-media';
import { TRPCError } from '@trpc/server';
import { v7 as uuidv7 } from 'uuid';
import { courseProcedure } from '../init.js';
import {
  getCourseOrThrow,
  initialVisibilityFields,
  requireAncestorsNotArchived,
  requireCourseInstructor,
  requireNotArchived,
  writeAtEnd,
  writeUnderActiveAncestors,
} from '../lib/course-lifecycle.js';
import {
  bestEffortDeleteLessonFileCopy,
  copyLessonFileUpload,
  headLessonFileUpload,
  lessonFileKey,
  lessonFileType,
  lessonFileUploadId,
  presignLessonFileUpload,
} from '../lib/lesson-files.js';
import { scheduleTranscodeCleanup } from '../lib/transcode-cleanup-scheduler.js';
import type { ICoreTableContext } from '../middleware/core-table.js';
import {
  CreateContentItemFileInputSchema,
  CreateContentItemFileOutputSchema,
  CreateContentItemFileUploadUrlInputSchema,
  CreateContentItemFileUploadUrlOutputSchema,
  CreateContentItemFileUrlInputSchema,
  CreateContentItemFileUrlOutputSchema,
  type ICreateContentItemFileOutput,
  type IUpdateContentItemFileOutput,
  LESSON_FILE_MAX_BYTES,
  LESSON_FILE_TYPES,
  UpdateContentItemFileInputSchema,
  UpdateContentItemFileOutputSchema,
} from '../schema/index.js';
import { asContentItemOutput } from './content-item-shared.js';

// File items (#102): a document students download. The file is uploaded to
// the lesson media upload bucket through a presigned PUT, then copied into
// the lesson media bucket when the item is saved (see lib/lesson-files.ts).

type CoreTable = NonNullable<ICoreTableContext['coreTable']>;

interface ItemKey {
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
}

const allowedTypes = () =>
  Object.keys(LESSON_FILE_TYPES)
    .map((extension) => `.${extension}`)
    .join(', ');

// The lesson the item is (to be) in, checked as for adding any content.
const requireActiveLesson = async (
  coreTable: CoreTable,
  { courseId, moduleId, lessonId }: Omit<ItemKey, 'contentItemId'>,
) => {
  const { data: lesson } = await coreTable.entities.lesson
    .get({ courseId, moduleId, lessonId })
    .go();
  if (!lesson) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
  requireNotArchived(lesson, 'Restore the lesson before adding content to it');
  await requireAncestorsNotArchived(coreTable, { courseId, moduleId });
};

// An existing file item, not archived.
const getEditableFileItem = async (coreTable: CoreTable, key: ItemKey) => {
  const { data: existing } = await coreTable.entities.contentItem.get(key).go();
  if (!existing || existing.type !== 'file') {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
  requireNotArchived(existing, 'Restore the content item before editing it');
  return existing;
};

// Checks an upload is one createContentItemFileUploadUrl issued for this item
// and file name, and that it's there with the type and size the upload URL
// held it to, then copies it into the lesson media bucket. Returns what the
// item records about it.
const takeUpload = async (
  key: ItemKey,
  objectKey: string,
  fileName: string,
) => {
  const uploadId = lessonFileUploadId(objectKey, key);
  const mimeType = lessonFileType(fileName);
  if (
    !uploadId ||
    !mimeType ||
    objectKey !== lessonFileKey(key, uploadId, fileName)
  ) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'That upload is not for this file item',
    });
  }
  const upload = await headLessonFileUpload(objectKey);
  if (
    upload?.contentType !== mimeType ||
    !upload.contentLength ||
    upload.contentLength > LESSON_FILE_MAX_BYTES
  ) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Upload the file before saving it',
    });
  }
  await copyLessonFileUpload(objectKey, { contentType: mimeType, fileName });
  return {
    s3Key: objectKey,
    submissionNonce: uploadId,
    fileName,
    fileSize: upload.contentLength,
    mimeType,
  };
};

export const createContentItemFileUploadUrl = courseProcedure
  .input(CreateContentItemFileUploadUrlInputSchema)
  .output(CreateContentItemFileUploadUrlOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, moduleId, lessonId, fileName, fileSize } = input;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
    await requireActiveLesson(coreTable, { courseId, moduleId, lessonId });
    const mimeType = lessonFileType(fileName);
    if (!mimeType) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Files of this type can't be attached. Allowed: ${allowedTypes()}`,
      });
    }
    if (input.contentItemId !== undefined) {
      await getEditableFileItem(coreTable, {
        courseId,
        moduleId,
        lessonId,
        contentItemId: input.contentItemId,
      });
    }

    // A replacement keeps its item's id; each upload gets its own folder, so
    // two uploads for the same item never overwrite each other.
    const contentItemId = input.contentItemId ?? uuidv7();
    const objectKey = lessonFileKey(
      { courseId, moduleId, lessonId, contentItemId },
      randomUUID(),
      fileName,
    );
    return {
      contentItemId,
      objectKey,
      ...(await presignLessonFileUpload(objectKey, mimeType, fileSize)),
    };
  });

export const createContentItemFile = courseProcedure
  .input(CreateContentItemFileInputSchema)
  .output(CreateContentItemFileOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { title, description, objectKey, fileName, ...key } = input;
    const { courseId, moduleId, lessonId } = key;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
    await requireActiveLesson(coreTable, { courseId, moduleId, lessonId });
    const course = await getCourseOrThrow(coreTable, courseId);

    const file = await takeUpload(key, objectKey, fileName);

    // Appended to the end of the lesson, as other content is.
    try {
      await writeAtEnd(coreTable, key, (entities, order) => [
        entities.contentItem
          .create({
            ...key,
            type: 'file',
            title,
            description,
            ...file,
            order,
            ...initialVisibilityFields(course),
          })
          .commit(),
      ]);
    } catch (error) {
      await bestEffortDeleteLessonFileCopy(ctx.logger, file.s3Key);
      throw error;
    }

    const { data: contentItem } = await coreTable.entities.contentItem
      .get(key)
      .go();
    return asContentItemOutput<ICreateContentItemFileOutput>(contentItem);
  });

export const updateContentItemFile = courseProcedure
  .input(UpdateContentItemFileInputSchema)
  .output(UpdateContentItemFileOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { title, description, objectKey, fileName, ...key } = input;
    const { courseId, moduleId, lessonId } = key;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);
    const existing = await getEditableFileItem(coreTable, key);
    await requireAncestorsNotArchived(coreTable, {
      courseId,
      moduleId,
      lessonId,
    });

    const file =
      objectKey !== undefined && fileName !== undefined
        ? await takeUpload(key, objectKey, fileName)
        : undefined;

    try {
      // Conditioned on the item still not archived and, for a new file, still
      // having the file read above: two replacements racing can't both win,
      // leaving a version nothing points at and nothing retires.
      await writeUnderActiveAncestors(
        coreTable,
        key,
        (entities) => [
          entities.contentItem
            .patch(key)
            .set({
              ...(title !== undefined && { title }),
              ...(description !== undefined && { description }),
              ...file,
            })
            .where((attr, op) =>
              file
                ? `${op.notExists(attr.archivedAt)} AND ${op.eq(attr.s3Key, existing.s3Key ?? '')}`
                : op.notExists(attr.archivedAt),
            )
            .commit(),
        ],
        async () => {
          await getEditableFileItem(coreTable, key);
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              'The file item was changed by another request; please retry',
          });
        },
      );
    } catch (error) {
      if (file) {
        await bestEffortDeleteLessonFileCopy(ctx.logger, file.s3Key);
      }
      throw error;
    }

    // The old file is retired the way a replaced video's version is, after a
    // delay, so a download link just handed out still works.
    if (file && existing.submissionNonce) {
      await scheduleTranscodeCleanup(ctx.logger, {
        ...key,
        submissionNonce: existing.submissionNonce,
      });
    }

    const { data: contentItem } = await coreTable.entities.contentItem
      .get(key)
      .go();
    return asContentItemOutput<IUpdateContentItemFileOutput>(contentItem);
  });

// A short-lived link for the instructor to download the file, as students
// get from core-api's contentItem.fileUrl.
export const createContentItemFileUrl = courseProcedure
  .input(CreateContentItemFileUrlInputSchema)
  .output(CreateContentItemFileUrlOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    await requireCourseInstructor(coreTable, input.courseId, ctx.user.sub);
    const { data: item } = await coreTable.entities.contentItem.get(input).go();
    if (!item || item.type !== 'file' || !item.s3Key) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    return { url: await getSignedCloudFrontFileUrl(item.s3Key) };
  });
