/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { isDeepStrictEqual } from 'node:util';
import { Logger } from '@aws-lambda-powertools/logger';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { resolveLessonMediaBucketName } from '@discava/common-server-utils/lesson-media-bucket';
import { s3ClientConfig } from '@discava/common-server-utils/local-dev';
import { playableVersion } from '@discava/common-server-utils/media-keys';
import { parseWebVtt } from '@discava/common-web-utils/webvtt';
import {
  type createCoreTableService,
  isShown,
  tracksForPlayback,
} from '@discava/core-table';
import { type ITranscriptDocument, resolveIndexName } from '@discava/search';
import type { Client } from '@opensearch-project/opensearch';
import type { EntityItem } from 'electrodb';
import type { TranscriptItemKey } from './transcript-actions.js';
import { toTranscriptDocuments } from './transcript-document.js';

const logger = new Logger({ serviceName: 'TranscriptSync' });

// Actions per _bulk request, and ids per page of the existing-id scan.
export const BATCH_SIZE = 500;

// Rounds a sync may take when each one's re-check finds the item changed
// again, before it gives up and leaves the batch to be retried.
export const MAX_SYNC_ROUNDS = 3;

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

export interface TranscriptSyncDeps {
  client: Client;
  coreTable: CoreTable;
  /** The WebVTT text at an S3 key of the lesson media bucket. */
  readCaptionFile: (key: string) => Promise<string>;
  /** For `indexedAt`; the clock by default. */
  now?: () => Date;
}

export interface TranscriptSyncResult {
  indexed: number;
  removed: number;
}

const assertNoBulkErrors = (response: {
  errors: boolean;
  items: unknown[];
}) => {
  if (response.errors) {
    throw new Error(
      `_bulk reported failures: ${JSON.stringify(response.items)}`,
    );
  }
};

/**
 * Every `_id` of the transcripts index whose `field` is `value`, sorted, read
 * with `search_after`: OpenSearch Serverless has no scroll API.
 */
export const indexedTranscriptIds = async (
  client: Client,
  field: string,
  value: string,
): Promise<string[]> => {
  const index = resolveIndexName('transcripts');
  const ids: string[] = [];
  let searchAfter: (string | number)[] | undefined;
  for (;;) {
    const { body } = await client.search({
      index,
      body: {
        size: BATCH_SIZE,
        _source: false,
        query: { term: { [field]: value } },
        sort: [{ _id: 'asc' }],
        ...(searchAfter && { search_after: searchAfter }),
      },
    });
    const hits = body.hits.hits as { _id: string; sort: (string | number)[] }[];
    ids.push(...hits.map((hit) => hit._id));
    if (hits.length < BATCH_SIZE) {
      return ids;
    }
    searchAfter = hits[hits.length - 1]?.sort;
  }
};

type BulkAction =
  | { type: 'index'; id: string; document: ITranscriptDocument }
  | { type: 'delete'; id: string };

// The actions as _bulk requests of at most BATCH_SIZE actions.
const bulk = async (client: Client, actions: BulkAction[]) => {
  const index = resolveIndexName('transcripts');
  for (let i = 0; i < actions.length; i += BATCH_SIZE) {
    const body: Record<string, unknown>[] = actions
      .slice(i, i + BATCH_SIZE)
      .flatMap((action): Record<string, unknown>[] =>
        action.type === 'index'
          ? [{ index: { _index: index, _id: action.id } }, action.document]
          : [{ delete: { _index: index, _id: action.id } }],
      );
    assertNoBulkErrors((await client.bulk({ body })).body);
  }
};

/** Removes every document whose `field` is `value`. Returns how many. */
export const deleteTranscriptsBy = async (
  client: Client,
  field: string,
  value: string,
): Promise<number> => {
  const ids = await indexedTranscriptIds(client, field, value);
  await bulk(
    client,
    ids.map((id) => ({ type: 'delete', id })),
  );
  return ids.length;
};

type ItemRecord = EntityItem<CoreTable['entities']['contentItem']>;
type VisibilityRecord = {
  visibility: 'hidden' | 'visible';
  archivedAt?: string;
};

interface Reads {
  item: ItemRecord | null;
  lesson: VisibilityRecord | null;
  module: VisibilityRecord | null;
}

/**
 * What the wanted documents depend on, without reading any caption file: the
 * three records shown, the item a video, the version it plays, its caption
 * revision and the tracks offered for that version. Two syncs that see the
 * same state want the same documents.
 */
export const syncStateOf = (
  item: ItemRecord | null | undefined,
  lesson: VisibilityRecord | null | undefined,
  module: VisibilityRecord | null | undefined,
) => {
  const version = item ? playableVersion(item) : undefined;
  return {
    shown:
      !!item && !!lesson && !!module && [item, lesson, module].every(isShown),
    isVideo: item?.type === 'video',
    versionId: version?.versionId,
    captionTracksRev: item?.captionTracksRev ?? 0,
    trackIds: version
      ? tracksForPlayback(item?.captionTracks, version.versionId).map(
          (track) => track.trackId,
        )
      : [],
  };
};

const readAll = async (
  coreTable: CoreTable,
  key: TranscriptItemKey,
): Promise<Reads> => {
  const { courseId, moduleId, lessonId, contentItemId } = key;
  const [{ data: item }, { data: lesson }, { data: module }] =
    await Promise.all([
      coreTable.entities.contentItem
        .get({ courseId, moduleId, lessonId, contentItemId })
        .go({ consistent: true }),
      coreTable.entities.lesson
        .get({ courseId, moduleId, lessonId })
        .go({ consistent: true }),
      coreTable.entities.module
        .get({ courseId, moduleId })
        .go({ consistent: true }),
    ]);
  return { item, lesson, module };
};

const isNotFound = (error: unknown): boolean =>
  (error as { name?: string })?.name === 'NoSuchKey' ||
  (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode === 404;

// The documents the table's state wants: none unless the item is a shown video
// with a playable version, then the passages of every track offered for it.
const wantedDocuments = async (
  deps: TranscriptSyncDeps,
  key: TranscriptItemKey,
  { item, lesson, module }: Reads,
): Promise<{ id: string; document: ITranscriptDocument }[]> => {
  const state = syncStateOf(item, lesson, module);
  const version = item ? playableVersion(item) : undefined;
  if (!item || !state.shown || !state.isVideo || !version) {
    return [];
  }
  const tracks = tracksForPlayback(item.captionTracks, version.versionId);
  const trackLanguages = [...new Set(tracks.map((track) => track.language))];
  const now = (deps.now ?? (() => new Date()))();
  const perTrack = await Promise.all(
    tracks.map(async (track) => {
      let text: string;
      try {
        text = await deps.readCaptionFile(track.key);
      } catch (error) {
        if (!isNotFound(error)) {
          throw error;
        }
        // Deleted between the table read and the fetch: the item's next
        // record corrects it.
        logger.warn('A caption file was not found', {
          key: track.key,
          contentItemId: key.contentItemId,
        });
        return [];
      }
      return toTranscriptDocuments({
        item: key,
        versionId: version.versionId,
        track,
        trackLanguages,
        cues: parseWebVtt(text),
        now,
      });
    }),
  );
  return perTrack.flat();
};

/**
 * Makes the transcripts index hold what the core table says one item's
 * documents should be (contracts/transcript-indexing.md, "syncItemTranscripts").
 * Reads the table, writes only the index. Idempotent and order-insensitive:
 * every document id is the item's, track's and passage's own, and what is
 * wanted comes from the table as it is now, not from the record that
 * mentioned the item.
 *
 * Two syncs of one item can overlap, and the one that read the older state can
 * finish last. So after writing, the three records are read again; if what the
 * documents depend on changed, the sync runs again with the new reads.
 */
export const syncItemTranscripts = async (
  deps: TranscriptSyncDeps,
  key: TranscriptItemKey,
): Promise<TranscriptSyncResult> => {
  const { client, coreTable } = deps;
  let indexed = 0;
  let removed = 0;
  // The ids this sync wrote: the index is near-real-time, so a later round's
  // search might not show them yet, and they may need deleting.
  const written = new Set<string>();

  let reads = await readAll(coreTable, key);
  for (let round = 1; ; round++) {
    const state = syncStateOf(reads.item, reads.lesson, reads.module);
    const wanted = await wantedDocuments(deps, key, reads);
    const wantedIds = new Set(wanted.map(({ id }) => id));
    const existing = new Set([
      ...(await indexedTranscriptIds(
        client,
        'contentItemId',
        key.contentItemId,
      )),
      ...written,
    ]);
    const stale = [...existing].filter((id) => !wantedIds.has(id)).sort();

    await bulk(client, [
      ...wanted.map(({ id, document }) => ({
        type: 'index' as const,
        id,
        document,
      })),
      ...stale.map((id) => ({ type: 'delete' as const, id })),
    ]);
    for (const id of stale) {
      written.delete(id);
    }
    for (const id of wantedIds) {
      written.add(id);
    }
    indexed += wanted.length;
    removed += stale.length;

    const reread = await readAll(coreTable, key);
    if (
      isDeepStrictEqual(
        state,
        syncStateOf(reread.item, reread.lesson, reread.module),
      )
    ) {
      return { indexed, removed };
    }
    if (round === MAX_SYNC_ROUNDS) {
      throw new Error(
        `Transcripts of ${key.contentItemId} changed during ${MAX_SYNC_ROUNDS} syncs`,
      );
    }
    reads = reread;
  }
};

let s3Client: S3Client | undefined;

/** The WebVTT text at `key` of the lesson media bucket. */
export const readCaptionFileFromS3 = async (key: string): Promise<string> => {
  s3Client ??= new S3Client(s3ClientConfig());
  const { Body } = await s3Client.send(
    new GetObjectCommand({
      Bucket: await resolveLessonMediaBucketName(),
      Key: key,
    }),
  );
  return (await Body?.transformToString()) ?? '';
};
