/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCoreTableService } from '../service.js';
import { courseLandingWrites, normaliseLandingList } from './course-landing.js';
import { InvalidRequestError } from './errors.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;
let service: CoreTable;
beforeAll(async () => {
  process.env.LOCAL_DEV = 'true';
  service = await createCoreTableService();
});

type Request = Record<string, any>;
const part = (item: unknown): Request => {
  const [kind, request] = Object.entries(item as object)[0] as [
    string,
    Request,
  ];
  return { kind, ...request } as Request;
};

const NOW = new Date('2026-11-18T12:00:00.000Z');
const names = (request: Request) =>
  Object.values(request.ExpressionAttributeNames ?? {});
const values = (request: Request) =>
  Object.values(request.ExpressionAttributeValues ?? {});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(service.entities.courseInstructor.query, 'primary').mockReturnValue({
    go: async () => ({
      data: [{ instructorId: 'i1' }, { instructorId: 'i2' }],
    }),
  } as never);
});

const write = async (
  lists: { learningOutcomes?: string[]; requirements?: string[] } = {},
) =>
  (
    await courseLandingWrites.set(service, {
      courseId: 'c1',
      learningOutcomes: [],
      requirements: [],
      now: NOW,
      ...lists,
    })
  ).map(part);

describe('normaliseLandingList', () => {
  it('trims each item, keeping the order', () => {
    expect(normaliseLandingList(['  one ', 'two\n'])).toEqual(['one', 'two']);
  });

  it('takes 10 items and refuses an 11th', () => {
    const items = Array.from({ length: 10 }, (_, i) => `item ${i}`);
    expect(normaliseLandingList(items)).toHaveLength(10);
    expect(() => normaliseLandingList([...items, 'one more'])).toThrow(
      InvalidRequestError,
    );
  });

  it('takes 160 characters and refuses 161', () => {
    expect(normaliseLandingList(['a'.repeat(160)])).toHaveLength(1);
    expect(() => normaliseLandingList(['a'.repeat(161)])).toThrow(
      /item 1 must be 1 to 160/,
    );
  });

  it('counts characters after trimming', () => {
    expect(normaliseLandingList([` ${'a'.repeat(160)} `])).toEqual([
      'a'.repeat(160),
    ]);
  });

  it('refuses an empty or whitespace-only item, naming its position', () => {
    expect(() => normaliseLandingList(['ok', '   '], 'Requirements')).toThrow(
      'Requirements item 2 must be 1 to 160 characters',
    );
    expect(() => normaliseLandingList([''])).toThrow(InvalidRequestError);
  });
});

describe('courseLandingWrites.set', () => {
  it('patches the course and each instructor, in one list', async () => {
    const items = await write({ learningOutcomes: ['Build'] });

    expect(items.map((i) => i.kind)).toEqual(['Update', 'Update', 'Update']);
    expect(items[0].Key.pk).toContain('c1');
  });

  it('sets a list, trimmed, and removes the one that is empty', async () => {
    const [course] = await write({ learningOutcomes: [' Build '] });

    expect(course.UpdateExpression).toMatch(/^SET /);
    expect(values(course)).toContainEqual(['Build']);
    expect(course.UpdateExpression).toContain('REMOVE #requirements');
    expect(names(course)).toContain('learningOutcomes');
  });

  it('clears each list on its own', async () => {
    const [cleared] = await write();
    expect(cleared.UpdateExpression).toContain('#learningOutcomes');
    expect(cleared.UpdateExpression).toContain('#requirements');
    expect(cleared.UpdateExpression).not.toMatch(/SET [^R]*learningOutcomes_u/);

    const [onlyRequirements] = await write({ requirements: ['A laptop'] });
    expect(onlyRequirements.UpdateExpression).toContain(
      'REMOVE #learningOutcomes',
    );
    expect(values(onlyRequirements)).toContainEqual(['A laptop']);
  });

  it('gives the course and its instructors the same updatedAt', async () => {
    const [course, ...instructors] = await write({ requirements: ['x'] });

    expect(values(course)).toContain(NOW.toISOString());
    expect(instructors).toHaveLength(2);
    for (const instructor of instructors) {
      expect(names(instructor)).toContain('courseUpdatedAt');
      expect(values(instructor)).toContain(NOW.toISOString());
    }
  });

  it('writes no two items for the same key', async () => {
    const items = await write({ learningOutcomes: ['a'], requirements: ['b'] });
    const keys = items.map((i) => `${i.Key.pk}|${i.Key.sk}`);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('refuses a bad list before reading anything', async () => {
    await expect(
      write({ learningOutcomes: Array.from({ length: 11 }, () => 'x') }),
    ).rejects.toThrow(InvalidRequestError);
    expect(
      service.entities.courseInstructor.query.primary,
    ).not.toHaveBeenCalled();
  });

  it('requires the course to exist', async () => {
    const [course] = await write();
    expect(course.ConditionExpression).toContain('attribute_exists');
  });
});
