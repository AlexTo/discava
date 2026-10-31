/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { courseQueryByStatus, bulkMock, searchMock } = vi.hoisted(() => ({
  courseQueryByStatus: vi.fn(),
  bulkMock: vi.fn(),
  searchMock: vi.fn(),
}));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: { course: { query: { byStatus: courseQueryByStatus } } },
  })),
}));

vi.mock('../client.js', () => ({
  getOpenSearchClient: vi.fn(async () => ({
    bulk: bulkMock,
    search: searchMock,
  })),
  resolveIndexName: (name: string) => name,
}));

const { backfill } = await import('./backfill.js');

const course = (courseId: string, title = 'Title') => ({
  courseId,
  title,
  description: undefined,
  publishedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const emptyIndexScan = () =>
  searchMock.mockResolvedValue({ body: { hits: { hits: [] } } });

beforeEach(() => {
  vi.clearAllMocks();
  bulkMock.mockResolvedValue({ body: { errors: false, items: [] } });
});

describe('backfill', () => {
  it('indexes every published course in one _bulk call per page, not one request each', async () => {
    courseQueryByStatus.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: [course('c1'), course('c2')],
        cursor: null,
      }),
    });
    emptyIndexScan();

    const result = await backfill();

    expect(bulkMock).toHaveBeenCalledTimes(1);
    const [{ body }] = bulkMock.mock.calls[0];
    expect(body).toEqual([
      { index: { _index: 'courses', _id: 'c1' } },
      expect.objectContaining({ courseId: 'c1', status: 'published' }),
      { index: { _index: 'courses', _id: 'c2' } },
      expect.objectContaining({ courseId: 'c2', status: 'published' }),
    ]);
    expect(result.courses).toBe(2);
  });

  it('pages through the core table, one _bulk call per page', async () => {
    const go = vi
      .fn()
      .mockResolvedValueOnce({ data: [course('c1')], cursor: 'next' })
      .mockResolvedValueOnce({ data: [course('c2')], cursor: null });
    courseQueryByStatus.mockReturnValue({ go });
    emptyIndexScan();

    const result = await backfill();

    expect(go).toHaveBeenNthCalledWith(1, { cursor: undefined });
    expect(go).toHaveBeenNthCalledWith(2, { cursor: 'next' });
    expect(bulkMock).toHaveBeenCalledTimes(2);
    expect(result.courses).toBe(2);
  });

  it('removes a document whose course is no longer published', async () => {
    courseQueryByStatus.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [course('c1')], cursor: null }),
    });
    searchMock.mockResolvedValueOnce({
      body: {
        hits: {
          hits: [
            { _id: 'c1', sort: ['c1'] },
            { _id: 'stale', sort: ['stale'] },
          ],
        },
      },
    });

    const result = await backfill();

    // One _bulk call to index c1, a second to delete the stale document.
    expect(bulkMock).toHaveBeenCalledTimes(2);
    const [{ body: deleteBody }] = bulkMock.mock.calls[1];
    expect(deleteBody).toEqual([
      { delete: { _index: 'courses', _id: 'stale' } },
    ]);
    expect(result.removed).toBe(1);
  });

  it('scans the index with search_after, not the scroll API', async () => {
    courseQueryByStatus.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [], cursor: null }),
    });
    searchMock.mockResolvedValue({ body: { hits: { hits: [] } } });

    await backfill();

    const [{ body }] = searchMock.mock.calls[0];
    expect(body).toMatchObject({ sort: [{ _id: 'asc' }], _source: false });
    expect(body.scroll).toBeUndefined();
  });

  it('throws if a _bulk call reports failures', async () => {
    courseQueryByStatus.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [course('c1')], cursor: null }),
    });
    bulkMock.mockResolvedValue({
      body: { errors: true, items: [{ index: { error: 'boom' } }] },
    });
    emptyIndexScan();

    await expect(backfill()).rejects.toThrow(/boom/);
  });
});
