/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { playableManifest } from '@discava/common-server-utils/media-keys';
import { type CoreTable, isOpenFreePreview } from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import type { IFreePreviewItem } from '../schema/index.js';

// The one named exception to "content needs an enrolment" (research R-2, R-9):
// a lesson an instructor marked as a free preview is open to anyone while
// isOpenFreePreview holds. Nothing else in core-api reads content without
// requireEnrolment, and the freePreview router is the only caller of this.

// The one place the refusal is made, so every reason looks the same.
export const previewNotAvailable = () =>
  new TRPCError({
    code: 'NOT_FOUND',
    message: 'This preview is not available',
  });

export const loadOpenFreePreview = async (
  coreTable: CoreTable,
  {
    courseId,
    moduleId,
    lessonId,
  }: { courseId: string; moduleId: string; lessonId: string },
) => {
  const [{ data: course }, { data: module }, { data: lesson }] =
    await Promise.all([
      coreTable.entities.course.get({ courseId }).go(),
      coreTable.entities.module.get({ courseId, moduleId }).go(),
      coreTable.entities.lesson.get({ courseId, moduleId, lessonId }).go(),
    ]);
  if (!course || !module || !lesson) {
    throw previewNotAvailable();
  }
  if (!isOpenFreePreview({ course, module, lesson })) {
    throw previewNotAvailable();
  }
  return { course, module, lesson };
};

// A content item as a visitor sees it. Each field is picked by name, never
// spread from the record, so nothing else the record holds can leave with it.
// Undefined for a type outside the union (an assignment).
export const asPreviewItem = (record: {
  type?: string;
  contentItemId: string;
  title: string;
  description?: string;
  durationSeconds?: number;
  status?: string;
  s3Key?: string;
  previousS3Key?: string;
  body?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  questions?: readonly unknown[];
}): IFreePreviewItem | undefined => {
  const base = {
    contentItemId: record.contentItemId,
    title: record.title,
    description: record.description,
  };
  switch (record.type) {
    case 'video':
      return {
        ...base,
        type: 'video',
        durationSeconds: record.durationSeconds,
        playable: playableManifest(record) !== undefined,
      };
    case 'text':
      return { ...base, type: 'text', body: record.body ?? '' };
    case 'file':
      return {
        ...base,
        type: 'file',
        fileName: record.fileName ?? '',
        fileSize: record.fileSize ?? 0,
        mimeType: record.mimeType ?? '',
      };
    case 'quiz':
      return {
        ...base,
        type: 'quiz',
        questionCount: record.questions?.length ?? 0,
      };
    default:
      return undefined;
  }
};
