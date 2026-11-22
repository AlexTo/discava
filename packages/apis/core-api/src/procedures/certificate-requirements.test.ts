/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { certificateRequirements } from './certificate.js';

const { db, writes } = vi.hoisted(() => ({
  db: {
    course: undefined as any,
    items: [] as any[],
    enrolment: null as any,
    certificate: null as any,
    completions: [] as any[],
    summaries: [] as any[],
    submissions: [] as any[],
  },
  writes: vi.fn(),
}));

const go = (data: unknown) => ({ go: async () => ({ data }) });

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: {
      enrolment: { get: () => go(db.enrolment), patch: writes },
      certificate: { get: () => go(db.certificate), patch: writes },
      itemCompletion: {
        query: { primary: (key: any) => go(db.completions) },
      },
      assignmentSubmission: {
        query: { byUser: (key: any) => go(db.submissions) },
      },
      quizSummary: {
        query: {
          primary: (key: any) => ({
            where: () => go(db.summaries),
          }),
        },
      },
    },
    collections: {
      curriculum: () =>
        go({
          course: db.course ? [db.course] : [],
          module: [shown({ moduleId: 'm1', order: 1 })],
          lesson: [shown({ moduleId: 'm1', lessonId: 'l1', order: 1 })],
          contentItem: db.items,
        }),
    },
  })),
}));

const shown = <T extends object>(r: T) => ({
  visibility: 'visible' as const,
  ...r,
});

const text = (id: string) =>
  shown({
    moduleId: 'm1',
    lessonId: 'l1',
    contentItemId: id,
    type: 'text',
    title: id,
    order: 1,
  });
const quiz = (id: string, settings: object = {}) =>
  shown({
    moduleId: 'm1',
    lessonId: 'l1',
    contentItemId: id,
    type: 'quiz',
    title: `Quiz ${id}`,
    order: 2,
    settings: { passMarkPercent: 70, attemptsAllowed: 1, ...settings },
  });

const call = (sub: string | undefined = 'u1') =>
  (callerFor(t.router({ p: certificateRequirements }), { sub }) as any).p({
    courseId: 'c1',
  });

beforeEach(() => {
  writes.mockClear();
  db.course = {
    courseId: 'c1',
    status: 'published',
    certificatesEnabled: true,
    certificateCriteria: { version: 1, requireQuizPass: false },
  };
  db.items = [text('t1'), quiz('q1')];
  db.enrolment = { courseId: 'c1', userId: 'u1', status: 'active' };
  db.certificate = null;
  db.completions = [{ contentItemId: 't1' }];
  db.summaries = [];
  db.submissions = [];
});

describe('certificate.requirements', () => {
  it('refuses a caller who is not enrolled', async () => {
    db.enrolment = null;
    await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses a dropped enrolment', async () => {
    db.enrolment.status = 'dropped';
    await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses an anonymous caller', async () => {
    await expect(call(null as any)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('returns no requirements when certificates are off', async () => {
    db.course.certificatesEnabled = false;
    expect(await call()).toEqual({
      certificatesEnabled: false,
      certificate: null,
      allMet: false,
      requirements: [],
    });
  });

  it('returns only complete-items under the default criteria', async () => {
    const result = await call();
    expect(result.requirements).toEqual([
      { kind: 'complete-items', met: false, done: 1, total: 2 },
    ]);
    expect(result.allMet).toBe(false);
  });

  it('meets complete-items when the enrolment is completed', async () => {
    db.enrolment.status = 'completed';
    db.completions.push({ contentItemId: 'q1' });
    const result = await call();
    expect(result.requirements[0]).toMatchObject({ met: true, done: 2 });
    expect(result.allMet).toBe(true);
  });

  it('reports each quiz state under the criterion, passed ones included', async () => {
    db.course.certificateCriteria.requireQuizPass = true;
    db.items = [
      text('t1'),
      quiz('q1'),
      quiz('q2'),
      quiz('q3', { attemptsAllowed: null }),
      quiz('q4'),
    ];
    db.summaries = [
      { contentItemId: 'q1', attemptsUsed: 1, bestScore: 50 },
      { contentItemId: 'q2', attemptsUsed: 1, bestScore: 90, passedAt: 'x' },
      { contentItemId: 'q3', attemptsUsed: 2, bestScore: 10 },
    ];
    const { requirements } = await call();
    expect(requirements[1]).toEqual({
      kind: 'pass-quizzes',
      met: false,
      done: 1,
      total: 4,
      items: [
        {
          contentItemId: 'q1',
          lessonId: 'l1',
          title: 'Quiz q1',
          state: 'no-attempts-left',
        },
        {
          contentItemId: 'q2',
          lessonId: 'l1',
          title: 'Quiz q2',
          state: 'passed',
        },
        {
          contentItemId: 'q3',
          lessonId: 'l1',
          title: 'Quiz q3',
          state: 'not-passed',
        },
        {
          contentItemId: 'q4',
          lessonId: 'l1',
          title: 'Quiz q4',
          state: 'not-attempted',
        },
      ],
    });
  });

  it('reports each graded upload state with the returned score', async () => {
    db.course.certificateCriteria.minUploadScorePercent = 60;
    const work = (id: string, maxPoints = 10) => ({
      ...shown({
        moduleId: 'm1',
        lessonId: 'l1',
        contentItemId: id,
        type: 'assignment',
        title: `Work ${id}`,
        order: 3,
        maxPoints,
      }),
    });
    db.items = [text('t1'), work('w1'), work('w2'), work('w3'), work('w4')];
    db.submissions = [
      { contentItemId: 'w1', status: 'returned', points: 6, pointsOutOf: 10 },
      { contentItemId: 'w2', status: 'returned', points: 5, pointsOutOf: 10 },
      { contentItemId: 'w3', status: 'submitted' },
    ];

    const { requirements, allMet } = await call();

    expect(allMet).toBe(false);
    expect(requirements[1]).toEqual({
      kind: 'graded-uploads',
      met: false,
      done: 1,
      total: 4,
      minScorePercent: 60,
      items: [
        {
          contentItemId: 'w1',
          lessonId: 'l1',
          title: 'Work w1',
          state: 'met',
          scorePercent: 60,
        },
        {
          contentItemId: 'w2',
          lessonId: 'l1',
          title: 'Work w2',
          state: 'below-score',
          scorePercent: 50,
        },
        {
          contentItemId: 'w3',
          lessonId: 'l1',
          title: 'Work w3',
          state: 'awaiting-grade',
        },
        {
          contentItemId: 'w4',
          lessonId: 'l1',
          title: 'Work w4',
          state: 'not-submitted',
        },
      ],
    });
  });

  it('has allMet with no certificate yet', async () => {
    db.course.certificateCriteria.requireQuizPass = true;
    db.enrolment.status = 'completed';
    db.completions.push({ contentItemId: 'q1' });
    db.summaries = [
      { contentItemId: 'q1', attemptsUsed: 1, bestScore: 80, passedAt: 'x' },
    ];
    const result = await call();
    expect(result.allMet).toBe(true);
    expect(result.certificate).toBeNull();
  });

  it('returns the certificate once issued, in display form', async () => {
    db.certificate = { certificateId: '0123456789ABCDEF' };
    const result = await call();
    expect(result.certificate).toEqual({
      certificateId: '0123-4567-89AB-CDEF',
      status: 'valid',
    });
  });

  it('returns a revoked certificate’s status, time and reason', async () => {
    db.certificate = {
      certificateId: '0123456789ABCDEF',
      revokedAt: '2026-11-12T08:00:00.000Z',
      revocationReason: 'academic-integrity',
      revokedByRole: 'instructor',
    };
    const result = await call();
    expect(result.certificate).toEqual({
      certificateId: '0123-4567-89AB-CDEF',
      status: 'revoked',
      revokedAt: '2026-11-12T08:00:00.000Z',
      revocationReason: 'academic-integrity',
    });
    expect(JSON.stringify(result)).not.toContain('instructor');
  });

  it('returns a revoked certificate even with certificates turned off', async () => {
    db.course.certificatesEnabled = false;
    db.certificate = {
      certificateId: '0123456789ABCDEF',
      revokedAt: '2026-11-12T08:00:00.000Z',
      revocationReason: 'other',
      revokedByRole: 'admin',
    };
    expect((await call()).certificate).toMatchObject({ status: 'revoked' });
  });

  it('is NOT_FOUND for an unknown course', async () => {
    db.course = undefined;
    await expect(call()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('writes nothing', async () => {
    await call();
    expect(writes).not.toHaveBeenCalled();
  });
});
