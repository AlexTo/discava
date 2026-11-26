/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { errors as openSearchErrors } from '@opensearch-project/opensearch';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { categoryBySlug, listCategories } from './category.js';

const {
  searchMock,
  categoryQueryPrimary,
  categoryGet,
  categoryClaimGet,
  mockModule,
} = await vi.hoisted(async () => ({
  searchMock: vi.fn(),
  ...(await import('@discava/common-server-utils/trpc-testing')).mockCoreTable({
    category: ['query.primary', 'get'],
    categoryClaim: ['get'],
  }),
}));

vi.mock('@discava/search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/search')>()),
  getOpenSearchClient: vi.fn(async () => ({ search: searchMock })),
}));
vi.mock('@discava/core-table', async (importOriginal) =>
  mockModule(await importOriginal()),
);

const caller = t.createCallerFactory(
  t.router({ list: listCategories, bySlug: categoryBySlug }),
);
const callAnonymously = () =>
  caller({
    event: { requestContext: {} } as unknown as APIGatewayProxyEvent,
    context: {} as any,
    info: {} as any,
  });

const category = (n: number, status = 'active') => ({
  categoryId: `cat-${n}`,
  name: `Category ${String(n).padStart(2, '0')}`,
  slug: `category-${n}`,
  status,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('category.list', () => {
  it('gives the count query its own timeout and answers a retriable TIMEOUT when the collection is waking (#1146)', async () => {
    categoryQueryPrimary.mockReturnValue({ go: async () => ({ data: [] }) });
    searchMock.mockRejectedValue(new openSearchErrors.TimeoutError('slow'));

    await expect(callAnonymously().list()).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    expect(searchMock).toHaveBeenCalledWith(expect.anything(), {
      requestTimeout: 8_000,
      // The client retries a timeout 3 times by default: ~32 s, past the Lambda.
      maxRetries: 0,
    });
  });

  it('lists every active category with its course count, zero included, by name', async () => {
    const categories = Array.from({ length: 25 }, (_, i) => category(25 - i));
    categories.push(category(99, 'archived'));
    categoryQueryPrimary.mockReturnValue({
      go: async () => ({ data: categories }),
    });
    searchMock.mockResolvedValue({
      body: {
        aggregations: {
          categories: {
            buckets: [
              { key: 'cat-3', doc_count: 7 },
              { key: 'cat-99', doc_count: 2 },
            ],
          },
        },
      },
    });

    const result = await callAnonymously().list();

    expect(result).toHaveLength(25);
    expect(result[0]).toEqual({
      id: 'cat-1',
      name: 'Category 01',
      slug: 'category-1',
      courseCount: 0,
    });
    expect(result.map((c) => c.name)).toEqual(
      [...result.map((c) => c.name)].sort(),
    );
    expect(result.find((c) => c.id === 'cat-3')?.courseCount).toBe(7);
    expect(result.find((c) => c.id === 'cat-99')).toBeUndefined();
  });

  it('asks for a bucket per category, not the default ten, over published courses only', async () => {
    categoryQueryPrimary.mockReturnValue({ go: async () => ({ data: [] }) });
    searchMock.mockResolvedValue({ body: {} });

    await callAnonymously().list();

    const [[request]] = searchMock.mock.calls;
    expect(request.body.size).toBe(0);
    expect(request.body.aggs.categories.terms).toEqual({
      field: 'categoryId',
      size: 500,
    });
    expect(request.body.query.bool.filter).toEqual([
      { term: { status: 'published' } },
    ]);
  });
});

describe('category.bySlug', () => {
  it('returns a category by its slug', async () => {
    categoryClaimGet.mockReturnValue({
      go: async () => ({
        data: { claim: 'slug#category-1', categoryId: 'cat-1' },
      }),
    });
    categoryGet.mockReturnValue({ go: async () => ({ data: category(1) }) });

    await expect(
      callAnonymously().bySlug({ slug: 'category-1' }),
    ).resolves.toEqual({
      id: 'cat-1',
      name: 'Category 01',
      slug: 'category-1',
      status: 'active',
    });
    expect(categoryClaimGet).toHaveBeenCalledWith({ claim: 'slug#category-1' });
  });

  it('returns an archived category with its status', async () => {
    categoryClaimGet.mockReturnValue({
      go: async () => ({
        data: { claim: 'slug#category-1', categoryId: 'cat-1' },
      }),
    });
    categoryGet.mockReturnValue({
      go: async () => ({ data: category(1, 'archived') }),
    });

    await expect(
      callAnonymously().bySlug({ slug: 'category-1' }),
    ).resolves.toMatchObject({ status: 'archived' });
  });

  it('is NOT_FOUND for an unknown slug', async () => {
    categoryClaimGet.mockReturnValue({ go: async () => ({ data: null }) });

    await expect(
      callAnonymously().bySlug({ slug: 'nope' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
