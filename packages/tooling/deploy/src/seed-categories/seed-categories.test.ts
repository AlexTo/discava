/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { NameConflictError } from '@discava/core-table';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CATEGORIES, seedCategories } from './seed-categories.js';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('@discava/core-table', async (importActual) => ({
  ...(await importActual<typeof import('@discava/core-table')>()),
  categoryWrites: { create },
}));

const table = {} as Parameters<typeof seedCategories>[0];

describe('seedCategories', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('writes the five starting categories through categoryWrites', async () => {
    create.mockResolvedValue(undefined);

    await expect(seedCategories(table)).resolves.toEqual([
      ...DEFAULT_CATEGORIES,
    ]);

    expect(create.mock.calls.map(([, input]) => input.name)).toEqual([
      'Science',
      'Technology',
      'Mathematics',
      'Communication',
      'Business',
    ]);
    expect(
      new Set(create.mock.calls.map(([, input]) => input.categoryId)).size,
    ).toBe(5);
  });

  it('is idempotent by name: a name that exists is skipped, the rest still written', async () => {
    create.mockImplementation(async (_, { name }) => {
      if (name === 'Science' || name === 'Business') {
        throw new NameConflictError();
      }
    });

    await expect(seedCategories(table)).resolves.toEqual([
      'Technology',
      'Mathematics',
      'Communication',
    ]);
    expect(create).toHaveBeenCalledTimes(5);
  });

  it('creates nothing on a second run', async () => {
    create.mockRejectedValue(new NameConflictError());

    await expect(seedCategories(table)).resolves.toEqual([]);
  });

  it('does not hide other failures', async () => {
    create.mockRejectedValue(new Error('table unavailable'));

    await expect(seedCategories(table)).rejects.toThrow('table unavailable');
  });
});
