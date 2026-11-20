/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import { MAX_TRANSACTION_ITEMS } from './ancestor-writes.js';
import { type IReorderChildrenOptions, reorderChildren } from './reorder.js';

interface Child {
  id: string;
  order: number;
}

const changedError = () =>
  new TRPCError({ code: 'CONFLICT', message: 'changed' });

const setup = (
  children: Child[],
  overrides: Partial<IReorderChildrenOptions<Child>> = {},
) => {
  const readActive = vi.fn(async () => children.map((child) => ({ ...child })));
  const written: [string, number][] = [];
  const write = vi.fn(
    async (writes: (entities: never) => unknown[], onChanged: () => never) => {
      void onChanged;
      writes({} as never);
    },
  );
  const options: IReorderChildrenOptions<Child> = {
    ids: children.map(({ id }) => id),
    readActive,
    idOf: (child) => child.id,
    patch: ((_entities: unknown, id: string, order: number) => {
      written.push([id, order]);
      return { id, order };
    }) as IReorderChildrenOptions<Child>['patch'],
    write: write as unknown as IReorderChildrenOptions<Child>['write'],
    checkCount: 2,
    duplicateMessage: 'duplicate',
    tooManyMessage: (limit) => `limit ${limit}`,
    changedError,
    ...overrides,
  };
  return { options, readActive, write, written };
};

const abc = [
  { id: 'a', order: 1 },
  { id: 'b', order: 2 },
  { id: 'c', order: 3 },
];

describe('reorderChildren', () => {
  it('writes the new order and returns the children as re-read, sorted', async () => {
    const { options, write, written } = setup(abc, { ids: ['c', 'a', 'b'] });
    options.readActive = vi
      .fn()
      .mockResolvedValueOnce(abc)
      .mockResolvedValueOnce([
        { id: 'a', order: 2 },
        { id: 'b', order: 3 },
        { id: 'c', order: 1 },
      ]);

    const result = await reorderChildren(options);

    expect(write).toHaveBeenCalledTimes(1);
    expect(written).toEqual([
      ['c', 1],
      ['a', 2],
      ['b', 3],
    ]);
    expect(result.map(({ id }) => id)).toEqual(['c', 'a', 'b']);
  });

  it('writes nothing when the order is already the given one', async () => {
    const { options, write } = setup(abc);

    const result = await reorderChildren(options);

    expect(write).not.toHaveBeenCalled();
    expect(result.map(({ id }) => id)).toEqual(['a', 'b', 'c']);
  });

  it('rejects a duplicate id before reading anything', async () => {
    const { options, readActive } = setup(abc, { ids: ['a', 'a', 'b'] });

    await expect(reorderChildren(options)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'duplicate',
    });
    expect(readActive).not.toHaveBeenCalled();
  });

  it.each([
    ['one is missing', ['a', 'b']],
    ['one is unknown', ['a', 'b', 'x']],
    ['one is extra', ['a', 'b', 'c', 'd']],
  ])('throws changedError when %s', async (_name, ids) => {
    const { options, write } = setup(abc, { ids });

    await expect(reorderChildren(options)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'changed',
    });
    expect(write).not.toHaveBeenCalled();
  });

  it('refuses more children than fit in a transaction beside the checks', async () => {
    const many = Array.from({ length: MAX_TRANSACTION_ITEMS - 1 }, (_, i) => ({
      id: `id-${i}`,
      order: i + 1,
    }));
    const { options, write } = setup(many, { checkCount: 2 });

    await expect(reorderChildren(options)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: `limit ${MAX_TRANSACTION_ITEMS - 2}`,
    });
    expect(write).not.toHaveBeenCalled();
  });

  it('allows exactly as many children as fit', async () => {
    const fits = Array.from({ length: MAX_TRANSACTION_ITEMS - 2 }, (_, i) => ({
      id: `id-${i}`,
      order: i + 1,
    }));
    const { options } = setup(fits, {
      ids: fits.map(({ id }) => id).reverse(),
    });

    await expect(reorderChildren(options)).resolves.toHaveLength(fits.length);
  });

  it('passes a conflict handler to the write that throws changedError', async () => {
    const { options, write } = setup(abc, { ids: ['b', 'a', 'c'] });

    await reorderChildren(options);

    const onChanged = write.mock.calls[0]?.[1] as () => never;
    expect(onChanged).toThrow(expect.objectContaining({ message: 'changed' }));
  });

  it('propagates an error from the write', async () => {
    const { options, write } = setup(abc, { ids: ['b', 'a', 'c'] });
    write.mockRejectedValueOnce(new Error('boom'));

    await expect(reorderChildren(options)).rejects.toThrow('boom');
  });
});
