/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  BATCH_SIZE,
  deleteTranscriptsBy,
  indexedTranscriptIds,
  syncItemTranscripts,
  syncStateOf,
} from './transcript-sync.js';

const key = {
  courseId: 'c1',
  moduleId: 'm1',
  lessonId: 'l1',
  contentItemId: 'i1',
};

const manifest = (nonce: string) =>
  `courses/c1/modules/m1/lessons/l1/content-items/i1/${nonce}/master.m3u8`;

const track = (
  trackId: string,
  language: string,
  extra: Record<string, unknown> = {},
) => ({
  trackId,
  nonce: 'n1',
  language,
  label: language,
  source: 'auto',
  key: `captions/${trackId}.vtt`,
  isDefault: language === 'en',
  ...extra,
});

const item = (extra: Record<string, unknown> = {}) => ({
  ...key,
  type: 'video',
  status: 'ready',
  s3Key: manifest('n1'),
  visibility: 'visible',
  captionTracksRev: 1,
  captionTracks: [track('t1', 'en'), track('t2', 'es')],
  ...extra,
});

const shown = { visibility: 'visible' };

const vtt = (word: string) =>
  `WEBVTT\n\n00:00:00.000 --> 00:00:04.000\n${word} one\n\n00:00:04.000 --> 00:00:08.000\n${word} two\n`;

const idOf = (trackId: string, seq: number) =>
  `i1.${trackId}.${String(seq).padStart(5, '0')}`;

interface Tables {
  item: Record<string, unknown> | null;
  lesson: Record<string, unknown> | null;
  module: Record<string, unknown> | null;
}

// The table, the index and the caption files as the sync sees them. `onRead`
// runs before each read of the item, to change the table or hold a request.
const setup = (
  initial: Partial<Tables> = {},
  files: Record<string, string> = {},
) => {
  const tables: Tables = {
    item: item(),
    lesson: shown,
    module: shown,
    ...initial,
  } as Tables;
  const docs = new Map<string, Record<string, unknown>>();
  const bulkBodies: unknown[][] = [];
  const reads = { count: 0 };
  let bulkHook: (() => Promise<void>) | undefined;
  let itemReadHook: ((count: number) => void) | undefined;

  const client = {
    search: vi.fn(async ({ body }) => {
      const value = Object.values(body.query.term)[0];
      const ids = [...docs.entries()]
        .filter(([, doc]) => doc.contentItemId === value)
        .map(([id]) => id)
        .sort();
      return {
        body: {
          hits: { hits: ids.map((id) => ({ _id: id, sort: [id] })) },
        },
      };
    }),
    bulk: vi.fn(async ({ body }: { body: Record<string, unknown>[] }) => {
      await bulkHook?.();
      bulkBodies.push(body);
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
    }),
  };
  const get = (name: keyof Tables) => () => ({
    go: async () => {
      if (name === 'item') {
        reads.count++;
        itemReadHook?.(reads.count);
      }
      return { data: tables[name] };
    },
  });
  const coreTable = {
    entities: {
      contentItem: { get: vi.fn(get('item')) },
      lesson: { get: vi.fn(get('lesson')) },
      module: { get: vi.fn(get('module')) },
    },
  };
  const readCaptionFile = vi.fn(async (fileKey: string) => {
    if (!(fileKey in files)) {
      const error = new Error('no such key');
      error.name = 'NoSuchKey';
      throw error;
    }
    return files[fileKey];
  });
  const deps = {
    client: client as never,
    coreTable: coreTable as never,
    readCaptionFile,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  };
  return {
    tables,
    docs,
    client,
    coreTable,
    readCaptionFile,
    deps,
    bulkBodies,
    reads,
    holdBulk: (hook: () => Promise<void>) => {
      bulkHook = hook;
    },
    onItemRead: (hook: (count: number) => void) => {
      itemReadHook = hook;
    },
    sync: () => syncItemTranscripts(deps, key),
  };
};

const FILES = {
  'captions/t1.vtt': vtt('hello'),
  'captions/t2.vtt': vtt('hola'),
  'captions/t3.vtt': vtt('hi'),
  'captions/old.vtt': vtt('old'),
};

describe('syncItemTranscripts', () => {
  it('indexes the passages of every track of a shown video', async () => {
    const t = setup({}, FILES);

    const result = await t.sync();

    expect([...t.docs.keys()]).toEqual([idOf('t1', 0), idOf('t2', 0)]);
    expect(result).toEqual({ indexed: 2, removed: 0 });
    expect(t.docs.get(idOf('t1', 0))).toMatchObject({
      ...key,
      versionId: 'n1',
      trackId: 't1',
      language: 'en',
      trackLanguages: ['en', 'es'],
      text: 'hello one hello two',
    });
    expect(t.docs.get(idOf('t2', 0))).toMatchObject({
      language: 'es',
      trackLanguages: ['en', 'es'],
    });
  });

  // A failed document fails the item's whole sync, so one track the schema
  // refuses would leave the item's other tracks out of the index too.
  it('indexes an auto, an uploaded and a translated track of one video', async () => {
    const t = setup(
      {
        item: item({
          captionTracks: [
            track('t1', 'en'),
            track('t2', 'es', { source: 'translated', sourceTrackId: 't1' }),
            track('t3', 'fr', { source: 'uploaded' }),
          ],
        }),
      },
      FILES,
    );

    const result = await t.sync();

    expect(result).toEqual({ indexed: 3, removed: 0 });
    expect(
      [...t.docs.values()].map(({ trackId, source }) => [trackId, source]),
    ).toEqual([
      ['t1', 'auto'],
      ['t2', 'translated'],
      ['t3', 'uploaded'],
    ]);
  });

  it.each([
    ['a hidden item', { item: item({ visibility: 'hidden' }) }],
    ['an archived item', { item: item({ archivedAt: '2026-01-01' }) }],
    ['a hidden lesson', { lesson: { visibility: 'hidden' } }],
    ['a hidden module', { module: { visibility: 'hidden' } }],
    ['an item that is not a video', { item: item({ type: 'text' }) }],
    [
      'a video with no playable version',
      { item: item({ status: 'pending', s3Key: 'upload.mp4' }) },
    ],
    ['a video with no tracks', { item: item({ captionTracks: [] }) }],
    ['a missing item', { item: null }],
    ['a missing lesson', { lesson: null }],
  ])('removes every document of %s and indexes nothing', async (_, change) => {
    const t = setup(change, FILES);
    t.docs.set(idOf('t1', 0), { contentItemId: 'i1' });
    t.docs.set(idOf('t2', 0), { contentItemId: 'i1' });
    t.docs.set('other.t1.00000', { contentItemId: 'other' });

    const result = await t.sync();

    expect([...t.docs.keys()]).toEqual(['other.t1.00000']);
    expect(result).toEqual({ indexed: 0, removed: 2 });
  });

  it('removes the passages of a replaced track', async () => {
    const t = setup({}, FILES);
    await t.sync();

    t.tables.item = item({
      captionTracksRev: 2,
      captionTracks: [track('t3', 'en'), track('t2', 'es')],
    });
    await t.sync();

    expect([...t.docs.keys()]).toEqual([idOf('t2', 0), idOf('t3', 0)]);
  });

  it('indexes only the previous version’s tracks while an item is replaced', async () => {
    const t = setup(
      {
        item: item({
          status: 'pending',
          s3Key: 'upload.mp4',
          previousS3Key: manifest('n1'),
          captionTracks: [
            track('t1', 'en'),
            track('t3', 'en', { nonce: 'n2', key: 'captions/t3.vtt' }),
          ],
        }),
      },
      FILES,
    );

    await t.sync();

    expect([...t.docs.keys()]).toEqual([idOf('t1', 0)]);
    expect(t.docs.get(idOf('t1', 0))).toMatchObject({ versionId: 'n1' });
  });

  it('sends the same index actions and no deletes when run twice', async () => {
    const t = setup({}, FILES);
    await t.sync();
    await t.sync();

    const [first, second] = t.bulkBodies;
    expect(second).toEqual(first);
    expect(second.some((entry) => 'delete' in (entry as object))).toBe(false);
    expect([...t.docs.keys()]).toEqual([idOf('t1', 0), idOf('t2', 0)]);
  });

  it('counts a caption file that is not found as no passages for that track', async () => {
    const t = setup({}, { 'captions/t1.vtt': vtt('hello') });

    await t.sync();

    expect([...t.docs.keys()]).toEqual([idOf('t1', 0)]);
  });

  it('throws when a caption file cannot be read for another reason', async () => {
    const t = setup({}, FILES);
    t.readCaptionFile.mockRejectedValue(new Error('S3 is unavailable'));

    await expect(t.sync()).rejects.toThrow('S3 is unavailable');
  });

  it('leaves the index with only the newest track when an older sync lands last', async () => {
    const t1 = [track('t1', 'en')];
    const t2 = [track('t2', 'en')];
    const t = setup(
      { item: item({ captionTracksRev: 1, captionTracks: t1 }) },
      FILES,
    );

    // Sync A reads the item with T1 and holds its _bulk.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let hold = true;
    t.holdBulk(async () => {
      if (hold) {
        hold = false;
        await held;
      }
    });
    const syncA = t.sync();
    await vi.waitFor(() => expect(t.client.bulk).toHaveBeenCalledTimes(1));

    // The table moves on to T2, and sync B reads it and finishes.
    t.tables.item = item({ captionTracksRev: 2, captionTracks: t2 });
    await t.sync();
    expect([...t.docs.keys()]).toEqual([idOf('t2', 0)]);

    // A's _bulk lands last, with T1's documents.
    release();
    await syncA;

    expect([...t.docs.keys()]).toEqual([idOf('t2', 0)]);
  });

  it('throws after 3 rounds that each saw a change', async () => {
    const t = setup({}, FILES);
    // Every read of the item sees a new revision.
    t.onItemRead((count) => {
      t.tables.item = item({ captionTracksRev: count + 1 });
    });

    await expect(t.sync()).rejects.toThrow(/changed during 3 syncs/);
    // The first read, then one re-check per round.
    expect(t.reads.count).toBe(4);
  });

  it('stops after the round whose re-check sees no change', async () => {
    const t = setup({}, FILES);
    t.onItemRead((count) => {
      // Only the first re-check (the second read) sees a change.
      if (count === 2) {
        t.tables.item = item({ captionTracksRev: 2 });
      }
    });

    await t.sync();

    // The first read, the re-check that saw the change, then a clean one.
    expect(t.reads.count).toBe(3);
  });

  it('throws when _bulk reports errors', async () => {
    const t = setup({}, FILES);
    t.client.bulk.mockResolvedValue({
      body: { errors: true, items: [{ index: { status: 400 } }] },
    });

    await expect(t.sync()).rejects.toThrow('_bulk reported failures');
  });

  it('only reads the table', async () => {
    const t = setup({}, FILES);
    await t.sync();

    for (const entity of Object.values(t.coreTable.entities)) {
      expect(Object.keys(entity)).toEqual(['get']);
    }
  });

  it('reads the three records with consistent reads', async () => {
    const goCalls: unknown[] = [];
    const t = setup({}, FILES);
    const original = t.coreTable.entities.lesson.get;
    t.coreTable.entities.lesson.get = vi.fn((...args) => {
      const query = (original as (...a: unknown[]) => { go: () => unknown })(
        ...args,
      );
      return {
        go: (options?: unknown) => {
          goCalls.push(options);
          return query.go();
        },
      };
    }) as never;

    await t.sync();

    expect(goCalls.length).toBeGreaterThan(0);
    expect(
      goCalls.every((o) => (o as { consistent: boolean }).consistent),
    ).toBe(true);
  });
});

describe('syncStateOf', () => {
  const base = () => syncStateOf(item() as never, shown, shown);

  it.each([
    ['visibility', item({ visibility: 'hidden' })],
    ['version', item({ s3Key: manifest('n2') })],
    ['captionTracksRev', item({ captionTracksRev: 2 })],
    ['track', item({ captionTracks: [track('t9', 'en')] })],
    ['type', item({ type: 'text' })],
  ])('changes for a %s change', (_, changed) => {
    expect(syncStateOf(changed as never, shown, shown)).not.toEqual(base());
  });

  it('changes for a hidden lesson or module', () => {
    expect(
      syncStateOf(item() as never, { visibility: 'hidden' }, shown),
    ).not.toEqual(base());
    expect(
      syncStateOf(item() as never, shown, { visibility: 'hidden' }),
    ).not.toEqual(base());
  });

  it('does not change for a counter or title change', () => {
    expect(
      syncStateOf(
        item({ studentActivityCount: 5, title: 'New' }) as never,
        shown,
        shown,
      ),
    ).toEqual(base());
  });
});

describe('indexedTranscriptIds and deleteTranscriptsBy', () => {
  const pagedClient = (total: number) => {
    const ids = Array.from(
      { length: total },
      (_, index) => `i1.t1.${String(index).padStart(5, '0')}`,
    );
    return {
      search: vi.fn(async ({ body }) => {
        const start = body.search_after
          ? ids.indexOf(body.search_after[0]) + 1
          : 0;
        const page = ids.slice(start, start + body.size);
        return {
          body: { hits: { hits: page.map((id) => ({ _id: id, sort: [id] })) } },
        };
      }),
      bulk: vi.fn(async () => ({ body: { errors: false, items: [] } })),
      ids,
    };
  };

  it('pages through every id with search_after', async () => {
    const client = pagedClient(BATCH_SIZE + 3);

    const ids = await indexedTranscriptIds(client as never, 'courseId', 'c1');

    expect(ids).toEqual(client.ids);
    expect(client.search).toHaveBeenCalledTimes(2);
    expect(client.search.mock.calls[0][0].body).toMatchObject({
      _source: false,
      query: { term: { courseId: 'c1' } },
      sort: [{ _id: 'asc' }],
    });
  });

  it('deletes in _bulk requests of at most 500 actions', async () => {
    const client = pagedClient(2 * BATCH_SIZE + 1);

    const removed = await deleteTranscriptsBy(
      client as never,
      'contentItemId',
      'i1',
    );

    expect(removed).toBe(2 * BATCH_SIZE + 1);
    expect(client.bulk.mock.calls.map(([arg]) => arg.body.length)).toEqual([
      BATCH_SIZE,
      BATCH_SIZE,
      1,
    ]);
  });
});
