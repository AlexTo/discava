/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Curriculum } from '@discava/core-table';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recalculateStudent } from './recalculate.js';

// The table, as the recalculation reads and writes it.
const db = {
  enrolment: null as Record<string, unknown> | null,
  completions: [] as { contentItemId: string }[],
  progress: [] as { lessonId: string; status: string }[],
};

// Every write, as entity, key or item, the attributes set, and the condition
// rendered as a string.
const writes: {
  entity: string;
  op: 'upsert' | 'patch';
  item: Record<string, unknown>;
  set?: Record<string, unknown>;
  condition?: string;
}[] = [];

// The condition each conditional write meets, or not: a failed one throws
// as ElectroDB does.
let failCondition: (condition: string) => boolean = () => false;

const attr = new Proxy({}, { get: (_, name) => name });
const ops = {
  eq: (name: string, value: unknown) => `${name} = ${value}`,
  ne: (name: string, value: unknown) => `${name} <> ${value}`,
  notExists: (name: string) => `notExists(${name})`,
};

const writer = (
  entity: string,
  op: 'upsert' | 'patch',
  item: Record<string, unknown>,
) => {
  const write: (typeof writes)[number] = { entity, op, item };
  const chain = {
    set: (set: Record<string, unknown>) => {
      write.set = set;
      return chain;
    },
    where: (build: (a: unknown, o: typeof ops) => string) => {
      write.condition = build(attr, ops);
      return chain;
    },
    go: async () => {
      if (write.condition && failCondition(write.condition)) {
        throw Object.assign(new Error('conditional request failed'), {
          cause: Object.assign(new Error(), {
            name: 'ConditionalCheckFailedException',
          }),
        });
      }
      writes.push(write);
      return {};
    },
  };
  return chain;
};

const coreTable = {
  entities: {
    enrolment: {
      get: vi.fn(() => ({ go: async () => ({ data: db.enrolment }) })),
      patch: (key: Record<string, unknown>) =>
        writer('enrolment', 'patch', key),
    },
    itemCompletion: {
      query: {
        primary: vi.fn(() => ({ go: async () => ({ data: db.completions }) })),
      },
    },
    progress: {
      query: {
        primary: vi.fn(() => ({ go: async () => ({ data: db.progress }) })),
      },
      upsert: (item: Record<string, unknown>) =>
        writer('progress', 'upsert', item),
    },
  },
} as any;

const visible = { visibility: 'visible' as const };
// m1: l1 (a, b), l2 (c).
const curriculum: Curriculum = {
  modules: [{ moduleId: 'm1', ...visible }],
  lessons: [
    { moduleId: 'm1', lessonId: 'l1', ...visible },
    { moduleId: 'm1', lessonId: 'l2', ...visible },
  ],
  contentItems: [
    { moduleId: 'm1', lessonId: 'l1', contentItemId: 'a', ...visible },
    { moduleId: 'm1', lessonId: 'l1', contentItemId: 'b', ...visible },
    { moduleId: 'm1', lessonId: 'l2', contentItemId: 'c', ...visible },
  ],
};

const NOW = '2024-02-01T00:00:00.000Z';
const recalculate = () =>
  recalculateStudent(coreTable, 'course-1', curriculum, 'student-1', NOW);

const completed = (...ids: string[]) => {
  db.completions = ids.map((contentItemId) => ({ contentItemId }));
};

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
  failCondition = () => false;
  db.enrolment = {
    courseId: 'course-1',
    userId: 'student-1',
    status: 'active',
    progressPercent: 0,
  };
  db.completions = [];
  db.progress = [];
});

describe('recalculateStudent', () => {
  it('reads the student’s enrolment, completions and lesson progress in the course', async () => {
    await recalculate();

    expect(coreTable.entities.enrolment.get).toHaveBeenCalledWith({
      courseId: 'course-1',
      userId: 'student-1',
    });
    for (const query of [
      coreTable.entities.itemCompletion.query.primary,
      coreTable.entities.progress.query.primary,
    ]) {
      expect(query).toHaveBeenCalledWith({
        userId: 'student-1',
        courseId: 'course-1',
      });
    }
  });

  it('writes each lesson’s progress and the course percentage', async () => {
    completed('a', 'c');

    await recalculate();

    expect(writes).toEqual([
      expect.objectContaining({
        entity: 'progress',
        item: {
          userId: 'student-1',
          courseId: 'course-1',
          lessonId: 'l1',
          status: 'in_progress',
        },
        condition: 'notExists(status) OR status <> completed',
      }),
      expect.objectContaining({
        entity: 'progress',
        item: expect.objectContaining({
          lessonId: 'l2',
          status: 'completed',
          completedAt: NOW,
        }),
      }),
      expect.objectContaining({
        entity: 'enrolment',
        item: { courseId: 'course-1', userId: 'student-1' },
        set: { progressPercent: 66 },
        condition: 'status <> dropped',
      }),
    ]);
  });

  it('completes the course at 100%, only from active', async () => {
    completed('a', 'b', 'c');

    await recalculate();

    expect(writes.at(-1)).toMatchObject({
      entity: 'enrolment',
      set: { status: 'completed', completedAt: NOW },
      condition: 'status = active',
    });
  });

  // Idempotency: a duplicate event or a no-op edit writes nothing.
  it('writes nothing when nothing changed', async () => {
    completed('a');
    db.progress = [
      { lessonId: 'l1', status: 'in_progress' },
      { lessonId: 'l2', status: 'not_started' },
    ];
    db.enrolment = { ...db.enrolment, progressPercent: 33 };

    await recalculate();

    expect(writes).toEqual([]);
  });

  // Invariant: lesson completion is never cleared.
  it('never writes a completed lesson back to anything else', async () => {
    // b was hidden, then shown again: l1 is no longer all done.
    completed('a');
    db.progress = [{ lessonId: 'l1', status: 'completed' }];

    await recalculate();

    expect(writes.some((write) => write.item.lessonId === 'l1')).toBe(false);
  });

  // Invariant: adding content never un-completes a course.
  it('doesn’t write progress for a lesson the student hasn’t started', async () => {
    completed('a');

    await recalculate();

    expect(writes.filter(({ entity }) => entity === 'progress')).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({
          lessonId: 'l1',
          status: 'in_progress',
        }),
      }),
    ]);
  });

  it('writes a lesson back to not started when its only completed item stops counting', async () => {
    db.progress = [{ lessonId: 'l2', status: 'in_progress' }];
    db.enrolment = { ...db.enrolment, progressPercent: 33 };

    await recalculate();

    expect(writes).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({
          lessonId: 'l2',
          status: 'not_started',
        }),
      }),
      expect.objectContaining({
        entity: 'enrolment',
        set: { progressPercent: 0 },
      }),
    ]);
  });

  it('lowers the percentage of a completed course but keeps it completed', async () => {
    completed('a', 'b');
    db.enrolment = {
      ...db.enrolment,
      status: 'completed',
      progressPercent: 100,
    };

    await recalculate();

    expect(writes).toEqual([
      expect.objectContaining({ entity: 'progress' }),
      expect.objectContaining({
        entity: 'enrolment',
        set: { progressPercent: 66 },
      }),
    ]);
  });

  it('leaves a student who isn’t enrolled, or has dropped out, alone', async () => {
    completed('a', 'b', 'c');
    db.enrolment = null;
    await recalculate();
    db.enrolment = {
      courseId: 'course-1',
      userId: 'student-1',
      status: 'dropped',
    };
    await recalculate();

    expect(writes).toEqual([]);
  });

  it('lets a completion recorded by a racing run stand', async () => {
    completed('a', 'b', 'c');
    failCondition = (condition) =>
      condition.includes('status <> completed') ||
      condition === 'status = active';

    await expect(recalculate()).resolves.toBeUndefined();
  });

  it('fails on anything other than a lost condition, so the batch is retried', async () => {
    completed('a');
    coreTable.entities.progress.upsert = () => ({
      where: () => ({
        go: async () => {
          throw new Error('throttled');
        },
      }),
    });

    await expect(recalculate()).rejects.toThrow('throttled');
    coreTable.entities.progress.upsert = (item: Record<string, unknown>) =>
      writer('progress', 'upsert', item);
  });
});
