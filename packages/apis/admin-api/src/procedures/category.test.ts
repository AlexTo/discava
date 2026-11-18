/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  InvalidRequestError,
  NameConflictError,
  NotFoundError,
} from '@discava/core-table';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  archiveCategory,
  createCategory,
  listCategories,
  renameCategory,
} from './category.js';

const { categoryQueryPrimary, courseScan, categoryWrites } = vi.hoisted(() => ({
  categoryQueryPrimary: vi.fn(),
  courseScan: vi.fn(),
  categoryWrites: {
    create: vi.fn(),
    rename: vi.fn(),
    archive: vi.fn(),
  },
}));

// The helper's own rules (claims, slugs, races) are tested in core-table; here
// it is replaced to check what the procedures hand it and how they map its
// errors.
vi.mock('@discava/core-table', async (importActual) => ({
  ...(await importActual<typeof import('@discava/core-table')>()),
  categoryWrites,
  createCoreTableService: vi.fn(async () => ({
    entities: {
      category: { query: { primary: categoryQueryPrimary } },
      course: { scan: { go: courseScan } },
    },
  })),
}));

const router = t.router({
  list: listCategories,
  create: createCategory,
  rename: renameCategory,
  archive: archiveCategory,
});
const caller = t.createCallerFactory(router);

const callAs = (groups: string[] = ['admin']) =>
  caller({
    event: {
      requestContext: {
        authorizer: { claims: { sub: 'admin-1', 'cognito:groups': groups } },
      },
    } as unknown as APIGatewayProxyEvent,
    context: {} as any,
    info: {} as any,
  });

const science = {
  categoryId: 'cat-1',
  name: 'Science',
  slug: 'science',
  status: 'active' as const,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('authorization', () => {
  it.each([
    ['list', (c: ReturnType<typeof callAs>) => c.list()],
    ['create', (c: ReturnType<typeof callAs>) => c.create({ name: 'A' })],
    [
      'rename',
      (c: ReturnType<typeof callAs>) => c.rename({ id: 'x', name: 'A' }),
    ],
    ['archive', (c: ReturnType<typeof callAs>) => c.archive({ id: 'x' })],
  ])('%s is FORBIDDEN outside the admin group', async (_, call) => {
    await expect(call(callAs(['instructor']))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(categoryWrites.create).not.toHaveBeenCalled();
    expect(categoryWrites.rename).not.toHaveBeenCalled();
    expect(categoryWrites.archive).not.toHaveBeenCalled();
  });
});

describe('category.create', () => {
  it('returns the category with its slug', async () => {
    categoryWrites.create.mockResolvedValue(science);

    await expect(callAs().create({ name: ' Science ' })).resolves.toEqual({
      id: 'cat-1',
      name: 'Science',
      slug: 'science',
      status: 'active',
    });
    expect(categoryWrites.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: ' Science ',
        categoryId: expect.any(String),
      }),
    );
  });

  it('is CONFLICT when the name is taken', async () => {
    categoryWrites.create.mockRejectedValue(new NameConflictError());

    await expect(callAs().create({ name: 'SCIENCE' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it.each([
    ['empty', ''],
    ['61 characters', 'a'.repeat(61)],
    ['symbols only', '!!!'],
  ])('is BAD_REQUEST for a name that is %s', async (_, name) => {
    categoryWrites.create.mockRejectedValue(
      new InvalidRequestError('Not a usable name'),
    );

    await expect(callAs().create({ name })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});

describe('category.rename', () => {
  it('keeps the slug', async () => {
    categoryWrites.rename.mockResolvedValue({ ...science, name: 'Sciences' });

    await expect(
      callAs().rename({ id: 'cat-1', name: 'Sciences' }),
    ).resolves.toEqual({
      id: 'cat-1',
      name: 'Sciences',
      slug: 'science',
      status: 'active',
    });
    expect(categoryWrites.rename).toHaveBeenCalledWith(expect.anything(), {
      categoryId: 'cat-1',
      name: 'Sciences',
    });
  });

  it('is NOT_FOUND for an unknown id', async () => {
    categoryWrites.rename.mockRejectedValue(new NotFoundError());

    await expect(
      callAs().rename({ id: 'nope', name: 'A' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('is CONFLICT on a taken name', async () => {
    categoryWrites.rename.mockRejectedValue(new NameConflictError());

    await expect(
      callAs().rename({ id: 'cat-1', name: 'Maths' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('category.archive', () => {
  it('is idempotent: archiving an archived category returns it', async () => {
    const archived = { ...science, status: 'archived' as const };
    categoryWrites.archive.mockResolvedValue(archived);

    const first = await callAs().archive({ id: 'cat-1' });
    const second = await callAs().archive({ id: 'cat-1' });

    expect(first).toEqual(second);
    expect(second.status).toBe('archived');
  });

  it('is NOT_FOUND for an unknown id', async () => {
    categoryWrites.archive.mockRejectedValue(new NotFoundError());

    await expect(callAs().archive({ id: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('category.list', () => {
  it('includes archived categories, sorted by name, with course counts over every course status', async () => {
    categoryQueryPrimary.mockReturnValue({
      go: async () => ({
        data: [
          {
            ...science,
            categoryId: 'b',
            name: 'Technology',
            slug: 'technology',
          },
          { ...science, categoryId: 'a', status: 'archived' },
          { ...science, categoryId: 'c', name: 'Business', slug: 'business' },
        ],
      }),
    });
    courseScan.mockResolvedValue({
      data: [
        { courseId: '1', categoryId: 'a', status: 'draft' },
        { courseId: '2', categoryId: 'a', status: 'published' },
        { courseId: '3', categoryId: 'a', status: 'archived' },
        { courseId: '4', categoryId: 'b', status: 'published' },
        { courseId: '5', status: 'published' },
      ],
    });

    await expect(callAs().list()).resolves.toEqual([
      {
        id: 'c',
        name: 'Business',
        slug: 'business',
        status: 'active',
        courseCount: 0,
      },
      {
        id: 'a',
        name: 'Science',
        slug: 'science',
        status: 'archived',
        courseCount: 3,
      },
      {
        id: 'b',
        name: 'Technology',
        slug: 'technology',
        status: 'active',
        courseCount: 1,
      },
    ]);
    expect(courseScan).toHaveBeenCalledWith({ pages: 'all' });
  });
});
