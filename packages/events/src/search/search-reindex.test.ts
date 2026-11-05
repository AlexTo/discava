/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getOpenSearchClientMock, createCoreTableServiceMock } = vi.hoisted(
  () => ({
    getOpenSearchClientMock: vi.fn(),
    createCoreTableServiceMock: vi.fn(),
  }),
);

vi.mock('@discava/search', async (importActual) => {
  const actual = await importActual<typeof import('@discava/search')>();
  return { ...actual, getOpenSearchClient: getOpenSearchClientMock };
});
vi.mock('@discava/core-table', () => ({
  createCoreTableService: createCoreTableServiceMock,
}));

const { searchReindex, BATCH_SIZE } = await import('./search-reindex.js');

const course = (id: string, extra: Record<string, unknown> = {}) => ({
  courseId: id,
  title: `Course ${id}`,
  description: 'About',
  status: 'published',
  publishedAt: '2024-01-01',
  updatedAt: '2024-01-02',
  ...extra,
});

describe('searchReindex', () => {
  const client = { bulk: vi.fn(), search: vi.fn() };
  const go = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getOpenSearchClientMock.mockResolvedValue(client);
    createCoreTableServiceMock.mockResolvedValue({
      entities: { course: { query: { byStatus: () => ({ go }) } } },
    });
    client.bulk.mockResolvedValue({ body: { errors: false, items: [] } });
    client.search.mockResolvedValue({ body: { hits: { hits: [] } } });
  });

  it('indexes every page of published courses, with their image', async () => {
    go.mockResolvedValueOnce({
      data: [course('c1', { imageKey: 'img/c1.png' })],
      cursor: 'next',
    }).mockResolvedValueOnce({ data: [course('c2')], cursor: null });

    const result = await searchReindex();

    expect(result).toEqual({ indexed: 2, removed: 0 });
    expect(go).toHaveBeenNthCalledWith(2, {
      cursor: 'next',
      limit: BATCH_SIZE,
    });
    expect(client.bulk).toHaveBeenCalledTimes(2);
    const body = client.bulk.mock.calls[0]![0].body;
    expect(body[0]).toEqual({ index: { _index: 'courses', _id: 'c1' } });
    expect(body[1]).toMatchObject({
      courseId: 'c1',
      imageKey: 'img/c1.png',
      status: 'published',
    });
  });

  it('removes documents for courses that are no longer published', async () => {
    go.mockResolvedValue({ data: [course('c1')], cursor: null });
    client.search.mockResolvedValue({
      body: {
        hits: {
          hits: [
            { _id: 'c1', sort: ['c1'] },
            { _id: 'old', sort: ['old'] },
          ],
        },
      },
    });

    const result = await searchReindex();

    expect(result).toEqual({ indexed: 1, removed: 1 });
    expect(client.bulk).toHaveBeenLastCalledWith({
      body: [{ delete: { _index: 'courses', _id: 'old' } }],
    });
  });

  it('pages through the index with search_after to find stale ids', async () => {
    go.mockResolvedValue({ data: [], cursor: null });
    const full = Array.from({ length: BATCH_SIZE }, (_, i) => ({
      _id: `id${i}`,
      sort: [`id${i}`],
    }));
    client.search
      .mockResolvedValueOnce({ body: { hits: { hits: full } } })
      .mockResolvedValueOnce({ body: { hits: { hits: [] } } });

    const result = await searchReindex();

    expect(result.removed).toBe(BATCH_SIZE);
    expect(client.search.mock.calls[1]![0].body.search_after).toEqual([
      `id${BATCH_SIZE - 1}`,
    ]);
  });

  it('is idempotent: a second run sends the same documents', async () => {
    go.mockResolvedValue({ data: [course('c1')], cursor: null });
    await searchReindex();
    await searchReindex();
    expect(client.bulk.mock.calls[0]![0]).toEqual(
      client.bulk.mock.calls[1]![0],
    );
  });

  it('fails when _bulk reports item errors, before removing anything', async () => {
    go.mockResolvedValue({ data: [course('c1')], cursor: null });
    client.bulk.mockResolvedValue({
      body: { errors: true, items: [{ index: { status: 403 } }] },
    });

    await expect(searchReindex()).rejects.toThrow(/_bulk reported failures/);
    expect(client.search).not.toHaveBeenCalled();
  });

  it('fails when reading the core table fails', async () => {
    go.mockRejectedValue(new Error('throttled'));
    await expect(searchReindex()).rejects.toThrow('throttled');
    expect(client.bulk).not.toHaveBeenCalled();
  });
});
