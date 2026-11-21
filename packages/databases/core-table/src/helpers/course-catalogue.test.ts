/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCoreTable } from '../test-support/core-table.js';
import {
  courseCatalogueWrites,
  setCourseCaptionLanguages,
} from './course-catalogue.js';
import { InvalidRequestError, NotFoundError } from './errors.js';

const service = useCoreTable();

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
  vi.spyOn(service.entities.courseInstructor.query, 'primary').mockReturnValue({
    go: async () => ({ data: [] }),
  } as never);
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
  it('copies the course’s new updatedAt to each instructor’s record', async () => {
    stubCourse({ courseId: 'c1', updatedAt: '2026-11-18T02:00:00.000Z' });
    const goInstructorPatch = vi.fn(async () => ({ data: {} }));
    const set = vi.fn(() => ({ go: goInstructorPatch }));
    const patch = vi
      .spyOn(service.entities.courseInstructor, 'patch')
      .mockReturnValue({ set } as never);
    vi.spyOn(
      service.entities.courseInstructor.query,
      'primary',
    ).mockReturnValue({
      go: async () => ({
        data: [{ instructorId: 'i1' }, { instructorId: 'i2' }],
      }),
    } as never);

    await courseCatalogueWrites(service, {
      courseId: 'c1',
      categoryId: 'cat-1',
    });

    expect(patch).toHaveBeenCalledWith({ courseId: 'c1', instructorId: 'i1' });
    expect(patch).toHaveBeenCalledWith({ courseId: 'c1', instructorId: 'i2' });
    expect(set).toHaveBeenCalledWith({
      courseUpdatedAt: '2026-11-18T02:00:00.000Z',
    });
  });

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

describe('setCourseCaptionLanguages', () => {
  const save = (languages: string[], maxLanguages = 9, courseId = 'c1') =>
    setCourseCaptionLanguages(service, { courseId, languages, maxLanguages });

  // Records the patch the course gets: what it sets and removes.
  const stubPatch = () => {
    const calls: { set?: unknown; remove?: unknown }[] = [];
    const patch = vi
      .spyOn(service.entities.course, 'patch')
      .mockImplementation((() => {
        const call: { set?: unknown; remove?: unknown } = {};
        calls.push(call);
        const builder = {
          set: (v: unknown) => ((call.set = v), builder),
          remove: (v: unknown) => ((call.remove = v), builder),
          go: async () => ({ data: {} }),
        };
        return builder;
      }) as never);
    return { calls, patch };
  };

  it.each([
    ['an unknown tag', ['en-US', 'ko-KR']],
    ['a duplicate', ['en-US', 'en-US']],
    ['too many for the stage', ['en-US', 'es-ES', 'fr-FR']],
  ])('refuses %s', async (_n, languages) => {
    stubCourse({ courseId: 'c1' });
    const { calls } = stubPatch();
    await expect(save(languages, 2)).rejects.toBeInstanceOf(
      InvalidRequestError,
    );
    expect(calls).toHaveLength(0);
  });

  it('never allows more than nine, whatever the stage allows', async () => {
    stubCourse({ courseId: 'c1' });
    stubPatch();
    const all = [
      'en-US',
      'es-ES',
      'fr-FR',
      'de-DE',
      'pt-BR',
      'ja-JP',
      'zh-CN',
      'hi-IN',
      'ar-SA',
      'vi-VN',
    ];
    await expect(save(all, 20)).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(save(all.slice(0, 9), 20)).resolves.toBeUndefined();
  });

  it('refuses an unknown course', async () => {
    stubCourse(undefined);
    const { calls } = stubPatch();
    await expect(save(['es-ES'])).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toHaveLength(0);
  });

  it('keeps the order it is given and touches no catalogue field', async () => {
    stubCourse({ courseId: 'c1' });
    const { calls } = stubPatch();
    await save(['fr-FR', 'es-ES']);
    expect(calls).toEqual([{ set: { captionLanguages: ['fr-FR', 'es-ES'] } }]);
  });

  it('clears the attribute for an empty list', async () => {
    stubCourse({ courseId: 'c1' });
    const { calls } = stubPatch();
    await save([]);
    expect(calls).toEqual([{ remove: ['captionLanguages'] }]);
  });

  it('refreshes the instructors’ courseUpdatedAt', async () => {
    stubCourse({ courseId: 'c1', updatedAt: '2026-11-18T02:00:00.000Z' });
    stubPatch();
    const set = vi.fn(() => ({ go: async () => ({ data: {} }) }));
    const instructorPatch = vi
      .spyOn(service.entities.courseInstructor, 'patch')
      .mockReturnValue({ set } as never);
    vi.spyOn(
      service.entities.courseInstructor.query,
      'primary',
    ).mockReturnValue({
      go: async () => ({ data: [{ instructorId: 'i1' }] }),
    } as never);
    await save(['es-ES']);
    expect(instructorPatch).toHaveBeenCalledWith({
      courseId: 'c1',
      instructorId: 'i1',
    });
    expect(set).toHaveBeenCalledWith({
      courseUpdatedAt: '2026-11-18T02:00:00.000Z',
    });
  });

  it('is independent of a catalogue save, and the reverse', async () => {
    stubCourse({ courseId: 'c1' });
    const { calls } = stubPatch();
    await courseCatalogueWrites(service, { courseId: 'c1' });
    await save(['es-ES']);
    const catalogue = calls[0];
    expect(JSON.stringify(catalogue)).not.toContain('captionLanguages');
    expect(JSON.stringify(calls[1])).not.toMatch(
      /categoryId|tags|level|language"|durationHours/,
    );
  });
});
