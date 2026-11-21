/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { isDeepStrictEqual } from 'node:util';

/** The keys of a content item: what `syncItemTranscripts` reads it by. */
export interface TranscriptItemKey {
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
}

export type TranscriptAction =
  | { type: 'sync-item'; key: TranscriptItemKey }
  | { type: 'delete-by'; field: 'contentItemId'; value: string };

/** The part of a stream record the actions are decided from. */
export interface TranscriptStreamRecord {
  eventName?: string;
  dynamodb?: {
    NewImage?: Record<string, unknown>;
    OldImage?: Record<string, unknown>;
  };
}

// The attributes of a video whose change can change its documents: its
// captions and their revision, the version it plays (`status`, `s3Key`,
// `previousS3Key`) and whether students can see it.
const WATCHED_ATTRIBUTES = [
  'captionTracks',
  'captionTracksRev',
  'status',
  's3Key',
  'previousS3Key',
  'visibility',
  'archivedAt',
] as const;

const KEY_ATTRIBUTES = [
  'courseId',
  'moduleId',
  'lessonId',
  'contentItemId',
] as const;

// A record without its keys fails the batch: it can't be skipped without
// hiding a change.
const keyOf = (image: Record<string, unknown>): TranscriptItemKey => {
  for (const name of KEY_ATTRIBUTES) {
    if (typeof image[name] !== 'string' || image[name] === '') {
      throw new Error(`A contentItem record names no ${name}`);
    }
  }
  return {
    courseId: image.courseId as string,
    moduleId: image.moduleId as string,
    lessonId: image.lessonId as string,
    contentItemId: image.contentItemId as string,
  };
};

/**
 * What a stream record means for the transcripts index (contracts/
 * transcript-indexing.md, "Handler"), for a content item. Pure: the image
 * says which item changed, not what its documents should be; the sync reads
 * the table for that. Undefined when the record can't change a document.
 */
export const transcriptActionOf = (
  record: TranscriptStreamRecord,
): TranscriptAction | undefined => {
  const { NewImage: next, OldImage: previous } = record.dynamodb ?? {};
  const image = next ?? previous;
  if (image?.__edb_e__ !== 'contentItem') {
    return undefined;
  }
  const key = keyOf(image);

  switch (record.eventName) {
    case 'INSERT':
      return next?.type === 'video' && next.captionTracks != null
        ? { type: 'sync-item', key }
        : undefined;
    case 'MODIFY':
      return next?.type === 'video' &&
        WATCHED_ATTRIBUTES.some(
          (name) => !isDeepStrictEqual(next[name], previous?.[name]),
        )
        ? { type: 'sync-item', key }
        : undefined;
    case 'REMOVE':
      return {
        type: 'delete-by',
        field: 'contentItemId',
        value: key.contentItemId,
      };
    default:
      return undefined;
  }
};
