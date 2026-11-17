/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCoreTableService } from '../service.js';
import { courseCatalogueWrites } from './course-catalogue.js';
import { InvalidRequestError, NotFoundError } from './errors.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;
let service: CoreTable;
beforeAll(async () => {
  process.env.LOCAL_DEV = 'true';
  service = await createCoreTableService();
});

type Request = Record<string, any>;
const part = (item: unknown) => {
  const [kind, request] = Object.entries(item as object)[0] as [
    string,
    Request,
  ];
  return { kind, ...request };
};

let written: Request[];
let canceled: { code: string }[] | undefined;
const stubCourse = (course: Request | undefined) => {
  vi.spyOn(service.entities.course, 'get').mockReturnValue({
    go: async () => ({ data: course }),
  } as never);
};

beforeEach(() => {
  vi.restoreAllMocks();
  written = [];
  canceled = undefined;
  vi.spyOn(service.transaction, 'write').mockImplementation(((
    build: () => unknown[],
  ) => ({
    go: async () => {
      written.push(...build().map(part));
      return canceled
        ? { canceled: true, data: canceled }
        : { canceled: false, data: [] };
    },
  })) as never);
});

const patchOf = () => written.find((item) => item.kind === 'Update')!;
const names = (request: Request) =>
  Object.values(request.ExpressionAttributeNames ?? {});

describe('courseCatalogueWrites', () => {
  it('sets every field, normalising the tags', async () => {
    stubCourse({ courseId: 'c1' });

    await courseCatalogueWrites(service, {
      courseId: 'c1',
      categoryId: 'cat-1',
      tags: [' Data  Science ', 'SQL'],
      level: 'beginner',
      language: 'en',
      durationHours: 12,
    });

    const values = Object.values(patchOf().ExpressionAttributeValues);
    expect(values).toEqual(
      expect.arrayContaining([
        'cat-1',
        ['data science', 'sql'],
        'beginner',
        'en',
        12,
      ]),
    );
    expect(patchOf().UpdateExpression).not.toContain('REMOVE');
    expect(written.map((i) => i.kind)).toEqual(['Update', 'ConditionCheck']);
  });

  it('removes every omitted field', async () => {
    const goPatch = vi.fn(async () => ({ data: {} }));
    stubCourse({ courseId: 'c1', categoryId: 'cat-1' });
    vi.spyOn(service.entities.course, 'patch').mockReturnValue({
      set: () => ({ remove: () => ({ go: goPatch }) }),
    } as never);

    await courseCatalogueWrites(service, { courseId: 'c1' });

    expect(goPatch).toHaveBeenCalledOnce();
    expect(written).toHaveLength(0);
  });

  it('writes REMOVE for the omitted fields', async () => {
    stubCourse({ courseId: 'c1' });

    await courseCatalogueWrites(service, {
      courseId: 'c1',
      categoryId: 'cat-1',
      level: 'advanced',
    });

    expect(patchOf().UpdateExpression).toContain('REMOVE');
    expect(names(patchOf())).toEqual(
      expect.arrayContaining(['tags', 'language', 'durationHours']),
    );
  });

  it('conditions a new category on being active', async () => {
    stubCourse({ courseId: 'c1', categoryId: 'old' });

    await courseCatalogueWrites(service, { courseId: 'c1', categoryId: 'new' });

    const check = written.find((i) => i.kind === 'ConditionCheck')!;
    expect(check.Key.sk).toContain('new');
    expect(Object.values(check.ExpressionAttributeValues)).toContain('active');
  });

  it('refuses an archived or missing category', async () => {
    stubCourse({ courseId: 'c1' });
    canceled = [{ code: 'None' }, { code: 'ConditionalCheckFailed' }];

    await expect(
      courseCatalogueWrites(service, { courseId: 'c1', categoryId: 'gone' }),
    ).rejects.toThrow(InvalidRequestError);
  });

  it('allows keeping an archived current category', async () => {
    stubCourse({ courseId: 'c1', categoryId: 'archived-cat' });
    const goPatch = vi.fn(async () => ({ data: {} }));
    vi.spyOn(service.entities.course, 'patch').mockReturnValue({
      set: () => ({ remove: () => ({ go: goPatch }) }),
    } as never);

    await courseCatalogueWrites(service, {
      courseId: 'c1',
      categoryId: 'archived-cat',
      level: 'beginner',
    });

    expect(goPatch).toHaveBeenCalledOnce();
  });

  it('refuses an unknown course', async () => {
    stubCourse(undefined);

    await expect(
      courseCatalogueWrites(service, { courseId: 'nope' }),
    ).rejects.toThrow(NotFoundError);
  });

  it.each([
    ['a duration of 0', { durationHours: 0 }],
    ['a duration of 501', { durationHours: 501 }],
    ['a fractional duration', { durationHours: 1.5 }],
    ['an unknown level', { level: 'expert' }],
    ['an unknown language', { language: 'xx' }],
    ['a ninth tag', { tags: Array.from({ length: 9 }, (_, i) => `t${i}`) }],
  ])('refuses %s', async (_, over) => {
    stubCourse({ courseId: 'c1' });

    await expect(
      courseCatalogueWrites(service, { courseId: 'c1', ...(over as object) }),
    ).rejects.toThrow(InvalidRequestError);
    expect(written).toHaveLength(0);
  });

  it('accepts the bounds of a duration', async () => {
    stubCourse({ courseId: 'c1' });
    const goPatch = vi.fn(async () => ({ data: {} }));
    vi.spyOn(service.entities.course, 'patch').mockReturnValue({
      set: () => ({ remove: () => ({ go: goPatch }) }),
    } as never);

    await courseCatalogueWrites(service, { courseId: 'c1', durationHours: 1 });
    await courseCatalogueWrites(service, {
      courseId: 'c1',
      durationHours: 500,
    });

    expect(goPatch).toHaveBeenCalledTimes(2);
  });
});
