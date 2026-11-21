/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DynamoDBStreamSchema } from '@aws-lambda-powertools/parser/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

const {
  getOpenSearchClientMock,
  createCoreTableServiceMock,
  readCaptionFileMock,
} = vi.hoisted(() => ({
  getOpenSearchClientMock: vi.fn(),
  createCoreTableServiceMock: vi.fn(),
  readCaptionFileMock: vi.fn(),
}));

vi.mock('@discava/search', async (importActual) => {
  const actual = await importActual<typeof import('@discava/search')>();
  return { ...actual, getOpenSearchClient: getOpenSearchClientMock };
});

vi.mock('@discava/core-table', async (importActual) => {
  const actual = await importActual<typeof import('@discava/core-table')>();
  return { ...actual, createCoreTableService: createCoreTableServiceMock };
});

vi.mock('./transcript-sync.js', async (importActual) => {
  const actual = await importActual<typeof import('./transcript-sync.js')>();
  return { ...actual, readCaptionFileFromS3: readCaptionFileMock };
});

const { transcriptIndexing, SYNC_CONCURRENCY } = await import(
  './transcript-indexing.js'
);

type StreamEvent = z.infer<typeof DynamoDBStreamSchema>;
type StreamRecord = StreamEvent['Records'][number];

const manifest = (id: string) =>
  `courses/c1/modules/m1/lessons/l1/content-items/${id}/n1/master.m3u8`;

const track = (trackId: string) => ({
  trackId,
  nonce: 'n1',
  language: 'en',
  label: 'English',
  source: 'auto',
  key: `captions/${trackId}.vtt`,
  isDefault: true,
});

const item = (id: string, tracks: string[], extra = {}) => ({
  courseId: 'c1',
  moduleId: 'm1',
  lessonId: 'l1',
  contentItemId: id,
  type: 'video',
  status: 'ready',
  s3Key: manifest(id),
  visibility: 'visible',
  captionTracksRev: tracks.length,
  captionTracks: tracks.map(track),
  ...extra,
});

const record = (
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
  oldImage?: Record<string, unknown>,
  newImage?: Record<string, unknown>,
) =>
  ({
    eventName,
    dynamodb: { OldImage: oldImage, NewImage: newImage },
  }) as unknown as StreamRecord;

const edb = (image: Record<string, unknown>) => ({
  __edb_e__: 'contentItem',
  ...image,
});

// A change to an item's tracks. What the record says is deliberately not what
// the table holds, to show the handler reads the table.
const tracksChanged = (id: string, from: string[], to: string[]) =>
  record('MODIFY', edb(item(id, from)), edb(item(id, to)));

const event = (...records: StreamRecord[]) => ({ Records: records });

const FILE = 'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nHello there\n';

describe('transcriptIndexing', () => {
  const tables = new Map<string, Record<string, unknown>>();
  const docs = new Map<string, Record<string, unknown>>();
  const client = {
    search: vi.fn(),
    bulk: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    tables.clear();
    docs.clear();
    getOpenSearchClientMock.mockResolvedValue(client);
    readCaptionFileMock.mockResolvedValue(FILE);
    const get = (read: (key: Record<string, string>) => unknown) =>
      vi.fn((key: Record<string, string>) => ({
        go: async () => ({ data: read(key) }),
      }));
    createCoreTableServiceMock.mockResolvedValue({
      entities: {
        contentItem: {
          get: get((key) => tables.get(key.contentItemId) ?? null),
        },
        lesson: { get: get(() => ({ visibility: 'visible' })) },
        module: { get: get(() => ({ visibility: 'visible' })) },
      },
    });
    client.search.mockImplementation(async ({ body }) => {
      const value = Object.values(body.query.term)[0];
      const ids = [...docs.entries()]
        .filter(([, doc]) => doc.contentItemId === value)
        .map(([id]) => id)
        .sort();
      return {
        body: { hits: { hits: ids.map((id) => ({ _id: id, sort: [id] })) } },
      };
    });
    client.bulk.mockImplementation(
      async ({ body }: { body: Record<string, unknown>[] }) => {
        for (let i = 0; i < body.length; i++) {
          const action = body[i] as {
            index?: { _id: string };
            delete?: { _id: string };
          };
          if (action.index) {
            docs.set(action.index._id, body[++i]);
          } else if (action.delete) {
            docs.delete(action.delete._id);
          }
        }
        return { body: { errors: false, items: [] } };
      },
    );
  });

  const ids = () => [...docs.keys()].sort();

  it('creates no client for changes that cannot affect a document', async () => {
    await transcriptIndexing(
      event(
        record(
          'MODIFY',
          edb({ ...item('i1', ['t1']), studentActivityCount: 1 }),
          edb({ ...item('i1', ['t1']), studentActivityCount: 2 }),
        ),
        record('MODIFY', { __edb_e__: 'lesson' }, { __edb_e__: 'lesson' }),
      ),
    );

    expect(getOpenSearchClientMock).not.toHaveBeenCalled();
    expect(createCoreTableServiceMock).not.toHaveBeenCalled();
  });

  it('indexes an item from the table, not from the record', async () => {
    tables.set('i1', item('i1', ['t2']));

    await transcriptIndexing(event(tracksChanged('i1', [], ['t1'])));

    expect(ids()).toEqual(['i1.t2.00000']);
  });

  it('syncs an item once for two records of it', async () => {
    tables.set('i1', item('i1', ['t1']));

    await transcriptIndexing(
      event(tracksChanged('i1', [], ['t1']), tracksChanged('i1', ['t1'], [])),
    );

    expect(readCaptionFileMock).toHaveBeenCalledTimes(1);
  });

  it('deletes an item’s documents when it is removed', async () => {
    tables.set('i1', item('i1', ['t1']));
    tables.set('i2', item('i2', ['t1']));
    await transcriptIndexing(
      event(tracksChanged('i1', [], ['t1']), tracksChanged('i2', [], ['t1'])),
    );
    expect(ids()).toEqual(['i1.t1.00000', 'i2.t1.00000']);

    tables.delete('i1');
    await transcriptIndexing(event(record('REMOVE', edb(item('i1', ['t1'])))));

    expect(ids()).toEqual(['i2.t1.00000']);
  });

  it('leaves the same documents when a batch is delivered twice', async () => {
    tables.set('i1', item('i1', ['t1', 't2']));
    const batch = event(tracksChanged('i1', [], ['t1', 't2']));

    // Only `indexedAt` is the time of the write.
    const snapshot = () =>
      [...docs.entries()].map(([id, { indexedAt: _, ...doc }]) => [id, doc]);

    await transcriptIndexing(batch);
    const once = snapshot();
    await transcriptIndexing(batch);

    expect(once).toHaveLength(2);
    expect(snapshot()).toEqual(once);
  });

  it.each([
    ['in order', false],
    ['reversed', true],
  ])(
    'leaves the replaced track’s documents when "added" and "replaced" are handled %s',
    async (_, reversed) => {
      // The table holds the state after both changes.
      tables.set('i1', item('i1', ['t2']));
      const added = event(tracksChanged('i1', [], ['t1']));
      const replaced = event(tracksChanged('i1', ['t1'], ['t2']));

      for (const batch of reversed ? [replaced, added] : [added, replaced]) {
        await transcriptIndexing(batch);
      }

      expect(ids()).toEqual(['i1.t2.00000']);
    },
  );

  it('rejects the batch when a sync fails', async () => {
    tables.set('i1', item('i1', ['t1']));
    client.bulk.mockRejectedValue(new Error('collection unavailable'));

    await expect(
      transcriptIndexing(event(tracksChanged('i1', [], ['t1']))),
    ).rejects.toThrow('collection unavailable');
  });

  it('syncs at most 5 items at a time', async () => {
    const itemIds = Array.from({ length: 12 }, (_, index) => `i${index}`);
    for (const id of itemIds) {
      tables.set(id, item(id, ['t1']));
    }
    let running = 0;
    let peak = 0;
    readCaptionFileMock.mockImplementation(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return FILE;
    });

    await transcriptIndexing(
      event(...itemIds.map((id) => tracksChanged(id, [], ['t1']))),
    );

    expect(SYNC_CONCURRENCY).toBe(5);
    expect(peak).toBe(5);
    expect(docs.size).toBe(12);
  });
});
