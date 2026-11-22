/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getOpenSearchClientMock,
  createCoreTableServiceMock,
  syncItemTranscriptsMock,
} = vi.hoisted(() => ({
  getOpenSearchClientMock: vi.fn(),
  createCoreTableServiceMock: vi.fn(),
  syncItemTranscriptsMock: vi.fn(),
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
  return { ...actual, syncItemTranscripts: syncItemTranscriptsMock };
});

const { transcriptReindex, LOW_TIME_MILLISECONDS } = await import(
  './transcript-reindex.js'
);

const context = (remaining = 900_000) =>
  ({ getRemainingTimeInMillis: () => remaining }) as never;

// A course's curriculum: one video item per entry, plus a text item.
const curriculum = (courseId: string, videos: string[]) => ({
  data: {
    module: [],
    lesson: [],
    contentItem: [
      ...videos.map((id) => ({
        courseId,
        moduleId: 'm1',
        lessonId: 'l1',
        contentItemId: id,
        type: 'video',
      })),
      {
        courseId,
        moduleId: 'm1',
        lessonId: 'l1',
        contentItemId: `${courseId}-text`,
        type: 'text',
      },
    ],
  },
});

describe('transcriptReindex', () => {
  const client = { search: vi.fn(), bulk: vi.fn() };
  const courses: Record<string, string[]> = {};
  const byStatus: Record<string, string[]> = {};
  const courseCalls = vi.fn();
  // Ids in the index, by courseId.
  const indexed: Record<string, string[]> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    for (const store of [courses, byStatus, indexed]) {
      for (const key of Object.keys(store)) {
        delete store[key];
      }
    }
    getOpenSearchClientMock.mockResolvedValue(client);
    syncItemTranscriptsMock.mockResolvedValue({ indexed: 2, removed: 0 });
    createCoreTableServiceMock.mockResolvedValue({
      collections: {
        curriculum: ({ courseId }: { courseId: string }) => ({
          go: async ({ pages }: { pages: string }) => {
            expect(pages).toBe('all');
            courseCalls(courseId);
            return curriculum(courseId, courses[courseId] ?? []);
          },
        }),
      },
      entities: {
        course: {
          query: {
            byStatus: ({ status }: { status: string }) => ({
              go: async ({ pages }: { pages: string }) => {
                expect(pages).toBe('all');
                return {
                  data: (byStatus[status] ?? []).map((courseId) => ({
                    courseId,
                  })),
                };
              },
            }),
          },
        },
      },
    });
    client.search.mockImplementation(async ({ body }) => {
      const ids = (indexed[Object.values(body.query.term)[0] as string] ?? [])
        .slice()
        .sort();
      return {
        body: { hits: { hits: ids.map((id) => ({ _id: id, sort: [id] })) } },
      };
    });
    client.bulk.mockResolvedValue({ body: { errors: false, items: [] } });
  });

  const deletedIds = () =>
    client.bulk.mock.calls.flatMap(([{ body }]) =>
      (body as { delete?: { _id: string } }[]).flatMap(
        (action) => action.delete?._id ?? [],
      ),
    );

  it('rebuilds one course, and removes a document of an item no longer in its curriculum', async () => {
    courses.c1 = ['i1', 'i2'];
    indexed.c1 = ['i1.t1.00000', 'i2.t1.00000', 'gone.t1.00000'];

    const result = await transcriptReindex({ courseId: 'c1' }, context());

    expect(result).toEqual({ courses: 1, items: 2, indexed: 4, removed: 1 });
    expect(syncItemTranscriptsMock.mock.calls.map(([, key]) => key)).toEqual([
      expect.objectContaining({ contentItemId: 'i1' }),
      expect.objectContaining({ contentItemId: 'i2' }),
    ]);
    expect(deletedIds()).toEqual(['gone.t1.00000']);
  });

  it('rebuilds every course across statuses and pages', async () => {
    byStatus.draft = ['c1'];
    byStatus.published = ['c2', 'c3'];
    byStatus.archived = ['c4'];
    for (const id of ['c1', 'c2', 'c3', 'c4']) {
      courses[id] = [`${id}-v`];
    }

    const result = await transcriptReindex({}, context());

    expect(result).toEqual({ courses: 4, items: 4, indexed: 8, removed: 0 });
    expect(courseCalls.mock.calls.map(([id]) => id)).toEqual([
      'c1',
      'c2',
      'c3',
      'c4',
    ]);
    expect(result).not.toHaveProperty('cursor');
  });

  it('removes nothing on a second run', async () => {
    courses.c1 = ['i1'];
    indexed.c1 = ['i1.t1.00000'];

    await transcriptReindex({ courseId: 'c1' }, context());
    const second = await transcriptReindex({ courseId: 'c1' }, context());

    expect(second.removed).toBe(0);
    expect(deletedIds()).toEqual([]);
  });

  it('returns a cursor when little time remains, and the next call resumes after it', async () => {
    byStatus.published = ['c1', 'c2', 'c3'];
    for (const id of ['c1', 'c2', 'c3']) {
      courses[id] = [`${id}-v`];
    }
    // Too little time from the start: it still finishes one course, so a call
    // always makes progress.
    const running = context(LOW_TIME_MILLISECONDS - 1);

    const first = await transcriptReindex({}, running);

    expect(first.courses).toBe(1);
    expect(first.cursor).toEqual(expect.any(String));
    expect(courseCalls.mock.calls.map(([id]) => id)).toEqual(['c1']);

    const second = await transcriptReindex({ cursor: first.cursor }, running);

    expect(second.courses).toBe(1);
    expect(courseCalls.mock.calls.map(([id]) => id)).toEqual(['c1', 'c2']);

    const third = await transcriptReindex({ cursor: second.cursor }, context());

    expect(third.courses).toBe(1);
    expect(third).not.toHaveProperty('cursor');
    expect(courseCalls.mock.calls.map(([id]) => id)).toEqual([
      'c1',
      'c2',
      'c3',
    ]);
  });

  it('refuses a cursor it did not give', async () => {
    await expect(
      transcriptReindex({ cursor: 'nonsense' }, context()),
    ).rejects.toThrow('Not a transcript rebuild cursor');
  });
});
