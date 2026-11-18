/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCoreTableService } from '../service.js';
import { categoryWrites } from './category.js';
import {
  NameConflictError,
  NotFoundError,
  SlugUnavailableError,
} from './errors.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;
let service: CoreTable;
beforeAll(async () => {
  process.env.LOCAL_DEV = 'true';
  service = await createCoreTableService();
});

type Request = Record<string, any>;
// What a transaction item asks of DynamoDB.
const part = (item: unknown) => {
  const [kind, request] = Object.entries(item as object)[0] as [
    string,
    Request,
  ];
  return { kind, ...request };
};
const keyOf = (request: Request) => {
  const key = request.Item ?? request.Key;
  return `${key.pk}|${key.sk}`;
};

// A table of just keys, standing in for DynamoDB's conditional writes: a Put
// conditioned on "not exists" is cancelled when its key is there, and a
// cancelled transaction writes nothing. `claims` are the slug claims
// `claimedSlugs` reads.
let keys: Set<string>;
let transactions: ReturnType<typeof part>[][];
let nextCancellation: ({ code: string } | undefined)[] | undefined;

const stubTable = () => {
  keys = new Set();
  transactions = [];
  nextCancellation = undefined;
  vi.spyOn(service.transaction, 'write').mockImplementation(((
    build: () => unknown[],
  ) => ({
    go: async () => {
      const items = build().map(part);
      transactions.push(items);
      const results =
        nextCancellation ??
        items.map((item) =>
          item.kind === 'Put' &&
          item.ConditionExpression &&
          keys.has(keyOf(item))
            ? { code: 'ConditionalCheckFailed' }
            : { code: 'None' },
        );
      nextCancellation = undefined;
      if (results.some((r) => r?.code === 'ConditionalCheckFailed')) {
        return { canceled: true, data: results };
      }
      for (const item of items) {
        if (item.kind === 'Put') {
          keys.add(keyOf(item));
        } else if (item.kind === 'Delete') {
          keys.delete(keyOf(item));
        }
      }
      return { canceled: false, data: results };
    },
  })) as never);
  // The slug claims in the table, as the retry re-reads them.
  Object.defineProperty(service.entities.categoryClaim, 'query', {
    configurable: true,
    value: {
      primary: () => ({
        begins: ({ claim }: { claim: string }) => ({
          go: async () => ({
            data: [...keys]
              .map((key) => key.split('|')[1])
              .filter((sk) => sk.includes('slug#'))
              .map((sk) => ({ claim: sk.slice(sk.indexOf('slug#')) }))
              .filter((c) => c.claim.startsWith(claim)),
          }),
        }),
      }),
    },
  });
};

beforeEach(() => {
  vi.restoreAllMocks();
  stubTable();
});

const claimsOf = (request: Request) => request.Item.sk as string;

describe('categoryWrites.create', () => {
  it('writes the category and both claims in one transaction', async () => {
    const created = await categoryWrites.create(service, {
      categoryId: 'c1',
      name: '  Data  Science ',
    });

    expect(created).toMatchObject({
      name: 'Data Science',
      slug: 'data-science',
    });
    expect(transactions).toHaveLength(1);
    const items = transactions[0];
    expect(items.map((i) => i.kind)).toEqual(['Put', 'Put', 'Put']);
    expect(items[0].Item).toMatchObject({
      categoryId: 'c1',
      name: 'Data Science',
      slug: 'data-science',
      status: 'active',
    });
    expect(claimsOf(items[1])).toContain('slug#data-science');
    expect(claimsOf(items[2])).toContain('name#data science');
    expect(items[1].ConditionExpression).toContain('attribute_not_exists');
    expect(items[2].ConditionExpression).toContain('attribute_not_exists');
  });

  it('refuses a name another category has, ignoring case and spacing', async () => {
    await categoryWrites.create(service, { categoryId: 'c1', name: 'Science' });

    await expect(
      categoryWrites.create(service, { categoryId: 'c2', name: ' SCIENCE ' }),
    ).rejects.toThrow(NameConflictError);
  });

  it('lets one of two creates of a name at once win', async () => {
    const results = await Promise.allSettled([
      categoryWrites.create(service, { categoryId: 'c1', name: 'Science' }),
      categoryWrites.create(service, { categoryId: 'c2', name: 'science' }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(
      NameConflictError,
    );
  });

  it('retries a taken slug with a numeric suffix', async () => {
    nextCancellation = [
      { code: 'None' },
      { code: 'ConditionalCheckFailed' },
      { code: 'None' },
    ];
    keys.add('pk|categoryClaim#slug#science');

    const created = await categoryWrites.create(service, {
      categoryId: 'c2',
      name: 'Science!',
    });

    expect(created.slug).toBe('science-2');
    expect(transactions).toHaveLength(2);
    expect(claimsOf(transactions[1][1])).toContain('slug#science-2');
  });

  it('reports a taken name when both claims fail', async () => {
    nextCancellation = [
      { code: 'None' },
      { code: 'ConditionalCheckFailed' },
      { code: 'ConditionalCheckFailed' },
    ];

    await expect(
      categoryWrites.create(service, { categoryId: 'c2', name: 'Science' }),
    ).rejects.toThrow(NameConflictError);
    expect(transactions).toHaveLength(1);
  });

  it('gives two names that slug alike distinct slugs', async () => {
    const [a, b] = await Promise.all([
      categoryWrites.create(service, {
        categoryId: 'c1',
        name: 'Data Science',
      }),
      categoryWrites.create(service, {
        categoryId: 'c2',
        name: 'Data-Science',
      }),
    ]);

    expect([a.slug, b.slug].sort()).toEqual(['data-science', 'data-science-2']);
    const slugClaims = [...keys].filter((k) => k.includes('slug#'));
    const nameClaims = [...keys].filter((k) => k.includes('name#'));
    expect(slugClaims).toHaveLength(2);
    expect(nameClaims).toHaveLength(2);
  });

  it('gives up with a typed error when the slug stays taken', async () => {
    const taken = [
      { code: 'None' },
      { code: 'ConditionalCheckFailed' },
      { code: 'None' },
    ];
    const write = service.transaction.write as unknown as ReturnType<
      typeof vi.fn
    >;
    write.mockImplementation(() => ({
      go: async () => ({ canceled: true, data: taken }),
    }));

    await expect(
      categoryWrites.create(service, { categoryId: 'c2', name: 'Science' }),
    ).rejects.toThrow(SlugUnavailableError);
    expect(write).toHaveBeenCalledTimes(5);
  });
});

describe('categoryWrites.rename', () => {
  const current = {
    categoryId: 'c1',
    name: 'Data Science',
    slug: 'data-science',
    status: 'active',
  };
  const stubGet = (value: unknown) =>
    vi
      .spyOn(service.entities.category, 'get')
      .mockReturnValue({ go: async () => ({ data: value }) } as never);

  it.each(['data science', 'Data  Science', ' DATA SCIENCE '])(
    'only patches the name for a case or spacing change (%s)',
    async (name) => {
      stubGet(current);
      const go = vi.fn(async () => ({ data: {} }));
      vi.spyOn(service.entities.category, 'patch').mockReturnValue({
        set: () => ({ where: () => ({ go }) }),
      } as never);

      const renamed = await categoryWrites.rename(service, {
        categoryId: 'c1',
        name,
      });

      expect(go).toHaveBeenCalledOnce();
      expect(transactions).toHaveLength(0);
      expect(renamed.slug).toBe('data-science');
    },
  );

  it('moves the name claim and keeps the slug claim', async () => {
    stubGet(current);

    await categoryWrites.rename(service, {
      categoryId: 'c1',
      name: 'Analytics',
    });

    const [items] = transactions;
    expect(items.map((i) => i.kind)).toEqual(['Update', 'Put', 'Delete']);
    expect(claimsOf(items[1])).toContain('name#analytics');
    expect(items[2].Key.sk).toContain('name#data science');
    expect(JSON.stringify(items)).not.toContain('slug#');
    expect(JSON.stringify(items[0])).not.toContain('"slug"');
  });

  it('refuses a name another category has', async () => {
    stubGet(current);
    nextCancellation = [
      { code: 'None' },
      { code: 'ConditionalCheckFailed' },
      { code: 'None' },
    ];

    await expect(
      categoryWrites.rename(service, { categoryId: 'c1', name: 'Analytics' }),
    ).rejects.toThrow(NameConflictError);
  });

  it('refuses an unknown category', async () => {
    stubGet(undefined);

    await expect(
      categoryWrites.rename(service, { categoryId: 'nope', name: 'Analytics' }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('categoryWrites.archive', () => {
  it('patches the status, conditioned on active', async () => {
    const params = service.entities.category
      .patch({ categoryId: 'c1' })
      .set({ status: 'archived' })
      .where((attr, op) => op.eq(attr.status, 'active'))
      .params() as Request;

    expect(params.UpdateExpression).toContain('SET');
    expect(JSON.stringify(params.ExpressionAttributeValues)).toContain(
      'archived',
    );
    expect(JSON.stringify(params.ExpressionAttributeValues)).toContain(
      'active',
    );
  });

  it('is a no-op for an archived category', async () => {
    const conditional = Object.assign(new Error('failed'), {
      cause: Object.assign(new Error('failed'), {
        name: 'ConditionalCheckFailedException',
      }),
    });
    vi.spyOn(service.entities.category, 'patch').mockReturnValue({
      set: () => ({
        where: () => ({
          go: async () => {
            throw conditional;
          },
        }),
      }),
    } as never);
    vi.spyOn(service.entities.category, 'get').mockReturnValue({
      go: async () => ({ data: { categoryId: 'c1', status: 'archived' } }),
    } as never);

    await expect(
      categoryWrites.archive(service, { categoryId: 'c1' }),
    ).resolves.toMatchObject({ status: 'archived' });
  });

  it('refuses an unknown category', async () => {
    const conditional = Object.assign(new Error('failed'), {
      cause: Object.assign(new Error('failed'), {
        name: 'ConditionalCheckFailedException',
      }),
    });
    vi.spyOn(service.entities.category, 'patch').mockReturnValue({
      set: () => ({
        where: () => ({
          go: async () => {
            throw conditional;
          },
        }),
      }),
    } as never);
    vi.spyOn(service.entities.category, 'get').mockReturnValue({
      go: async () => ({ data: undefined }),
    } as never);

    await expect(
      categoryWrites.archive(service, { categoryId: 'nope' }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('a category slug', () => {
  it('is never written by any call after creation', () => {
    const source = categoryWrites.rename.toString();
    expect(source).not.toMatch(/slug\s*:/);
  });
});
