/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { myEnrolments } from './my-enrolments.js';

// Per course: its record and outline. Per user: enrolments, progress and
// completions.
const { db, queries } = vi.hoisted(() => ({
  db: {
    courses: {} as Record<string, any>,
    modules: {} as Record<string, any[]>,
    lessons: {} as Record<string, any[]>,
    items: {} as Record<string, any[]>,
    enrolments: [] as any[],
    progress: [] as any[],
    completions: {} as Record<string, any[]>,
  },
  queries: [] as { entity: string; key: Record<string, unknown> }[],
}));

const query = (entity: string, rows: (key: any) => any[]) => ({
  query: {
    primary: (key: any) => ({
      go: vi.fn(async () => {
        queries.push({ entity, key });
        return { data: rows(key) };
      }),
    }),
  },
});

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: {
      enrolment: {
        query: {
          byUser: () => ({ go: async () => ({ data: db.enrolments }) }),
        },
      },
      progress: query('progress', () => db.progress),
      course: {
        get: ({ courseId }: { courseId: string }) => ({
          go: async () => ({ data: db.courses[courseId] ?? null }),
        }),
      },
      module: query('module', ({ courseId }) => db.modules[courseId] ?? []),
      lesson: query('lesson', ({ courseId }) => db.lessons[courseId] ?? []),
      contentItem: query(
        'contentItem',
        ({ courseId }) => db.items[courseId] ?? [],
      ),
      itemCompletion: query(
        'itemCompletion',
        ({ courseId }) => db.completions[courseId] ?? [],
      ),
    },
  })),
}));

const caller = t.createCallerFactory(t.router({ myEnrolments }));
const USER_SUB = 'student-1';
const call = () =>
  caller({
    event: {
      requestContext: { authorizer: { claims: { sub: USER_SUB } } },
    } as unknown as APIGatewayProxyEvent,
    context: {} as any,
    info: {} as any,
  }).myEnrolments();

const shown = { visibility: 'visible' };

// A course with two modules: m1 (order 1) holding l1 and l2, m2 (order 2)
// holding l3; each lesson holding one item.
const addCourse = (
  courseId: string,
  overrides: Record<string, unknown> = {},
) => {
  db.courses[courseId] = {
    courseId,
    title: `Course ${courseId}`,
    status: 'published',
    ...overrides,
  };
  db.modules[courseId] = [
    { moduleId: `${courseId}-m2`, title: 'Unit 2', order: 2, ...shown },
    { moduleId: `${courseId}-m1`, title: 'Unit 1', order: 1, ...shown },
  ];
  db.lessons[courseId] = [
    {
      moduleId: `${courseId}-m1`,
      lessonId: `${courseId}-l2`,
      title: 'Lesson 2',
      order: 2,
      ...shown,
    },
    {
      moduleId: `${courseId}-m1`,
      lessonId: `${courseId}-l1`,
      title: 'Lesson 1',
      order: 1,
      ...shown,
    },
    {
      moduleId: `${courseId}-m2`,
      lessonId: `${courseId}-l3`,
      title: 'Lesson 3',
      order: 1,
      ...shown,
    },
  ];
  db.items[courseId] = ['l1', 'l2', 'l3'].map((l) => ({
    moduleId: l === 'l3' ? `${courseId}-m2` : `${courseId}-m1`,
    lessonId: `${courseId}-${l}`,
    contentItemId: `${courseId}-${l}-item`,
    ...shown,
  }));
};

const enrol = (courseId: string, overrides: Record<string, unknown> = {}) =>
  db.enrolments.push({
    courseId,
    userId: USER_SUB,
    status: 'active',
    progressPercent: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  });

const completeLesson = (lessonId: string) =>
  db.progress.push({ userId: USER_SUB, lessonId, status: 'completed' });

beforeEach(() => {
  for (const key of [
    'courses',
    'modules',
    'lessons',
    'items',
    'completions',
  ] as const) {
    db[key] = {};
  }
  db.enrolments = [];
  db.progress = [];
  queries.length = 0;
});

describe('course.myEnrolments', () => {
  it('continues each course at its first lesson not completed, in course order', async () => {
    addCourse('c1');
    enrol('c1', {
      progressPercent: 33,
      lastActivityAt: '2026-10-05T00:00:00.000Z',
    });
    completeLesson('c1-l1');
    db.completions.c1 = [{ contentItemId: 'c1-l1-item' }];

    const { items } = await call();

    expect(items).toEqual([
      expect.objectContaining({
        courseId: 'c1',
        title: 'Course c1',
        courseStatus: 'published',
        status: 'active',
        progressPercent: 33,
        lastActivityAt: '2026-10-05T00:00:00.000Z',
        enrolledAt: '2026-10-01T00:00:00.000Z',
        nextLesson: {
          lessonId: 'c1-l2',
          title: 'Lesson 2',
          moduleTitle: 'Unit 1',
          moduleIndex: 0,
        },
        newItemCount: 0,
      }),
    ]);
  });

  it('skips lessons students can’t see', async () => {
    addCourse('c1');
    enrol('c1');
    db.lessons.c1[1].visibility = 'hidden'; // Lesson 1
    db.modules.c1[1].archivedAt = '2026-10-02'; // Unit 1, and so Lesson 2

    const [course] = (await call()).items;

    expect(course.nextLesson).toMatchObject({
      lessonId: 'c1-l3',
      moduleTitle: 'Unit 2',
      moduleIndex: 0,
    });
  });

  it('leaves out dropped enrolments, and lists the most recently active first', async () => {
    for (const id of ['c1', 'c2', 'c3']) {
      addCourse(id);
    }
    enrol('c1', { lastActivityAt: '2026-10-03T00:00:00.000Z' });
    // Never active: ordered by when they enrolled.
    enrol('c2', { createdAt: '2026-10-04T00:00:00.000Z' });
    enrol('c3', {
      status: 'dropped',
      lastActivityAt: '2026-10-09T00:00:00.000Z',
    });

    const { items } = await call();

    expect(items.map((item) => item.courseId)).toEqual(['c2', 'c1']);
  });

  it('counts items added to lessons the student had completed', async () => {
    addCourse('c1');
    enrol('c1', {
      status: 'completed',
      progressPercent: 75,
      completedAt: '2026-10-06T00:00:00.000Z',
    });
    for (const lesson of ['c1-l1', 'c1-l2', 'c1-l3']) {
      completeLesson(lesson);
    }
    // Added to Lesson 1 after it was completed.
    db.items.c1.push({
      moduleId: 'c1-m1',
      lessonId: 'c1-l1',
      contentItemId: 'c1-l1-added',
      ...shown,
    });
    db.completions.c1 = ['l1', 'l2', 'l3'].map((l) => ({
      contentItemId: `c1-${l}-item`,
    }));

    const [course] = (await call()).items;

    expect(course).toMatchObject({
      status: 'completed',
      completedAt: '2026-10-06T00:00:00.000Z',
      nextLesson: null,
      newItemCount: 1,
    });
  });

  it('reads completions only for a course with a completed lesson', async () => {
    addCourse('c1');
    enrol('c1');

    await call();

    expect(queries.map((q) => q.entity)).not.toContain('itemCompletion');
    // The student's progress, across their courses, in one query.
    expect(queries.filter((q) => q.entity === 'progress')).toEqual([
      { entity: 'progress', key: { userId: USER_SUB } },
    ]);
  });

  it('keeps archived courses, which stay readable', async () => {
    addCourse('c1', { status: 'archived' });
    enrol('c1');

    expect((await call()).items[0].courseStatus).toBe('archived');
  });

  it('rejects unauthenticated callers', async () => {
    const anonymous = caller({
      event: { requestContext: {} } as unknown as APIGatewayProxyEvent,
      context: {} as any,
      info: {} as any,
    });

    await expect(anonymous.myEnrolments()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});
