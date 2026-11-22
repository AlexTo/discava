/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CoreTable } from '../service.js';
import {
  DEFAULT_CERTIFICATE_CRITERIA,
  evaluateCertificateCriteria,
  scoreBand,
  setCertificateCriteria,
} from './certificate-criteria.js';
import { VersionConflictError } from './errors.js';

const shown = { visibility: 'visible' as const };
const quiz = (
  id: string,
  passMarkPercent: number,
  extra: Record<string, unknown> = {},
  order = 1,
) => ({
  ...shown,
  moduleId: 'm1',
  lessonId: 'l1',
  contentItemId: id,
  order,
  type: 'quiz',
  settings: { passMarkPercent, attemptsAllowed: null },
  ...extra,
});
const text = {
  ...shown,
  moduleId: 'm1',
  lessonId: 'l1',
  contentItemId: 't1',
  order: 0,
  type: 'text',
};
const curriculumOf = (
  contentItems: ReturnType<typeof quiz>[] | (typeof text)[],
  lessonExtra: Record<string, unknown> = {},
) => ({
  modules: [{ ...shown, moduleId: 'm1', order: 1 }],
  lessons: [
    { ...shown, moduleId: 'm1', lessonId: 'l1', order: 1, ...lessonExtra },
  ],
  contentItems: contentItems as never,
});
const summary = (
  contentItemId: string,
  bestScore: number,
  passed: boolean,
  attemptsUsed = 1,
) => ({
  contentItemId,
  attemptsUsed,
  bestScore,
  ...(passed && { passedAt: '2026-01-01T00:00:00.000Z' }),
});
const required = { version: 2, requireQuizPass: true };

describe('scoreBand', () => {
  it.each([
    [0, 0],
    [9, 0],
    [10, 10],
    [89, 80],
    [90, 90],
    [100, 90],
  ])('puts %i in band %i', (percent, band) => {
    expect(scoreBand(percent)).toBe(band);
  });
});

describe('evaluateCertificateCriteria', () => {
  it('meets the default criteria with an empty list and no band', () => {
    const { met, requirements, assessment } = evaluateCertificateCriteria({
      criteria: DEFAULT_CERTIFICATE_CRITERIA,
      curriculum: curriculumOf([text, quiz('q1', 70)]),
      quizSummaries: [],
    });
    expect(met).toBe(true);
    expect(requirements).toEqual([]);
    expect(assessment).toEqual({
      criteriaVersion: 1,
      requireQuizPass: false,
      itemCount: 2,
      assessedItemCount: 0,
      assessedItems: [],
    });
  });

  it('is not met while a quiz is failed', () => {
    const { met, requirements } = evaluateCertificateCriteria({
      criteria: required,
      curriculum: curriculumOf([quiz('q1', 70)]),
      quizSummaries: [summary('q1', 50, false)],
    });
    expect(met).toBe(false);
    expect(requirements).toEqual([
      {
        kind: 'pass-quizzes',
        quizzes: [{ contentItemId: 'q1', state: 'not-passed' }],
      },
    ]);
  });

  it('is met with every quiz passed, counting them and giving the marks and band', () => {
    const { met, assessment } = evaluateCertificateCriteria({
      criteria: required,
      curriculum: curriculumOf([quiz('q1', 60, {}, 1), quiz('q2', 80, {}, 2)]),
      quizSummaries: [summary('q1', 89, true), summary('q2', 81, true)],
    });
    expect(met).toBe(true);
    expect(assessment).toMatchObject({
      criteriaVersion: 2,
      requireQuizPass: true,
      assessedItemCount: 2,
      passMarkLowest: 60,
      passMarkHighest: 80,
      scoreBand: 80,
      assessedItems: [
        {
          contentItemId: 'q1',
          kind: 'quiz',
          scorePercent: 89,
          passMarkPercent: 60,
        },
        {
          contentItemId: 'q2',
          kind: 'quiz',
          scorePercent: 81,
          passMarkPercent: 80,
        },
      ],
    });
  });

  it('does not assess a quiz with pass mark 0, a hidden quiz or one in an archived lesson', () => {
    for (const [items, lessonExtra] of [
      [[quiz('q1', 0)], {}],
      [[quiz('q1', 70, { visibility: 'hidden' })], {}],
      [[quiz('q1', 70)], { archivedAt: '2026-01-01T00:00:00.000Z' }],
    ] as const) {
      const { met, assessment } = evaluateCertificateCriteria({
        criteria: required,
        curriculum: curriculumOf([...items], lessonExtra),
        quizSummaries: [],
      });
      expect(met).toBe(true);
      expect(assessment.assessedItemCount).toBe(0);
      expect(assessment.scoreBand).toBeUndefined();
    }
  });

  it('counts a quiz in an assignment lesson', () => {
    const { met } = evaluateCertificateCriteria({
      criteria: required,
      curriculum: curriculumOf([quiz('q1', 70)], { kind: 'assignment' }),
      quizSummaries: [],
    });
    expect(met).toBe(false);
  });

  it('is met with no assessed quiz at all', () => {
    const { met, assessment } = evaluateCertificateCriteria({
      criteria: required,
      curriculum: curriculumOf([text]),
      quizSummaries: [],
    });
    expect(met).toBe(true);
    expect(assessment.assessedItemCount).toBe(0);
  });

  it('does not count a quiz passed under a pass mark that has since been raised past the best score', () => {
    const { met, requirements } = evaluateCertificateCriteria({
      criteria: required,
      curriculum: curriculumOf([quiz('q1', 70)]),
      // Passed at 60 when the mark was 50; the mark is now 70.
      quizSummaries: [summary('q1', 60, true)],
    });
    expect(met).toBe(false);
    expect(requirements[0].quizzes).toEqual([
      { contentItemId: 'q1', state: 'not-passed' },
    ]);
  });

  it('still counts it when the best score reaches the raised mark', () => {
    const { met, assessment } = evaluateCertificateCriteria({
      criteria: required,
      curriculum: curriculumOf([quiz('q1', 70)]),
      quizSummaries: [summary('q1', 70, true)],
    });
    expect(met).toBe(true);
    expect(assessment.assessedItems[0]).toMatchObject({
      scorePercent: 70,
      passMarkPercent: 70,
    });
  });

  it('gives each requirement state', () => {
    const limited = (id: string, order: number) =>
      quiz(
        id,
        70,
        { settings: { passMarkPercent: 70, attemptsAllowed: 2 } },
        order,
      );
    const { requirements } = evaluateCertificateCriteria({
      criteria: required,
      curriculum: curriculumOf([
        quiz('passed', 70, {}, 1),
        quiz('none', 70, {}, 2),
        limited('out', 3),
        quiz('failed', 70, {}, 4),
      ]),
      quizSummaries: [
        summary('passed', 90, true),
        summary('out', 10, false, 2),
        summary('failed', 10, false, 5),
      ],
    });
    expect(requirements[0].quizzes.map((q) => q.state)).toEqual([
      'passed',
      'not-attempted',
      'no-attempts-left',
      'not-passed',
    ]);
  });
});

// A course table with one course, whose patch is conditioned on the stored
// criteria version as the real one is. `beforeFirstPatch` runs between the
// first caller's read and its write, which is where a concurrent change lands.
const fakeCourseTable = (
  stored: { certificateCriteria: Record<string, unknown> } | undefined,
  beforeFirstPatch?: (state: { course: typeof stored }) => void,
  everyTime = false,
) => {
  const state = { course: stored, patches: 0 };
  let interleaved = false;
  const conflict = Object.assign(new Error('conditional'), {
    cause: Object.assign(new Error('conditional'), {
      name: 'ConditionalCheckFailedException',
    }),
  });
  const coreTable = {
    entities: {
      course: {
        get: () => ({
          go: async () => ({
            data: state.course && structuredClone(state.course),
          }),
        }),
        patch: () => {
          let values: Record<string, unknown> = {};
          let expected: unknown;
          const chain = {
            set: (v: Record<string, unknown>) => {
              values = v;
              return chain;
            },
            where: (cb: (attr: unknown, op: unknown) => unknown) => {
              cb(
                { certificateCriteria: { version: 'version' } },
                { eq: (_: unknown, version: unknown) => (expected = version) },
              );
              return chain;
            },
            go: async () => {
              if (everyTime || !interleaved) {
                interleaved = true;
                beforeFirstPatch?.(state);
              }
              state.patches++;
              if (state.course?.certificateCriteria.version !== expected) {
                throw conflict;
              }
              state.course = { ...state.course, ...values };
              return { data: structuredClone(state.course) };
            },
          };
          return chain;
        },
      },
    },
  } as unknown as CoreTable;
  return { state, coreTable };
};

describe('graded uploads', () => {
  const assignment = (id: string, order = 1, maxPoints = 10) => ({
    ...shown,
    moduleId: 'm1',
    lessonId: 'l1',
    contentItemId: id,
    order,
    type: 'assignment',
    maxPoints,
  });
  const submission = (
    contentItemId: string,
    status: 'submitted' | 'returned' | 'resubmission_requested',
    points?: number,
  ) => ({ contentItemId, status, points, pointsOutOf: 10 });
  const upload = {
    version: 3,
    requireQuizPass: false,
    minUploadScorePercent: 60,
  };
  const evaluate = (
    criteria: Parameters<typeof evaluateCertificateCriteria>[0]['criteria'],
    items: unknown[],
    submissions: ReturnType<typeof submission>[],
    quizSummaries: ReturnType<typeof summary>[] = [],
  ) =>
    evaluateCertificateCriteria({
      criteria,
      curriculum: curriculumOf(items as never),
      quizSummaries,
      submissions: submissions as never,
    });

  it('gives each state', () => {
    const { met, requirements } = evaluate(
      upload,
      [
        assignment('none', 1),
        assignment('wait', 2),
        assignment('low', 3),
        assignment('ok', 4),
      ],
      [
        submission('wait', 'submitted'),
        submission('low', 'returned', 5),
        submission('ok', 'returned', 6),
      ],
    );
    expect(met).toBe(false);
    expect(requirements).toEqual([
      {
        kind: 'graded-uploads',
        minScorePercent: 60,
        uploads: [
          { contentItemId: 'none', state: 'not-submitted' },
          { contentItemId: 'wait', state: 'awaiting-grade' },
          { contentItemId: 'low', state: 'below-score', scorePercent: 50 },
          { contentItemId: 'ok', state: 'met', scorePercent: 60 },
        ],
      },
    ]);
  });

  it('meets the threshold exactly and not one below it', () => {
    expect(
      evaluate(
        upload,
        [assignment('a', 1, 100)],
        [{ ...submission('a', 'returned', 60), pointsOutOf: 100 }],
      ).met,
    ).toBe(true);
    expect(
      evaluate(
        upload,
        [assignment('a', 1, 100)],
        [{ ...submission('a', 'returned', 59), pointsOutOf: 100 }],
      ).met,
    ).toBe(false);
  });

  it('records the uploads and mixes them into the band with quizzes', () => {
    const { met, assessment } = evaluate(
      { ...upload, requireQuizPass: true },
      [quiz('q1', 70), assignment('a')],
      [submission('a', 'returned', 7)],
      [summary('q1', 90, true)],
    );
    expect(met).toBe(true);
    expect(assessment.minUploadScorePercent).toBe(60);
    expect(assessment.assessedItems).toEqual([
      {
        contentItemId: 'q1',
        kind: 'quiz',
        scorePercent: 90,
        passMarkPercent: 70,
      },
      { contentItemId: 'a', kind: 'upload', scorePercent: 70 },
    ]);
    expect(assessment.scoreBand).toBe(80);
    expect(assessment.passMarkLowest).toBe(70);
  });

  it('is not met when the quiz criterion fails though the upload is met', () => {
    expect(
      evaluate(
        { ...upload, requireQuizPass: true },
        [quiz('q1', 70), assignment('a')],
        [submission('a', 'returned', 9)],
        [summary('q1', 10, false)],
      ).met,
    ).toBe(false);
  });

  it('is met with only the upload criterion and no visible assignment', () => {
    const { met, requirements, assessment } = evaluate(upload, [text], []);
    expect(met).toBe(true);
    expect(requirements).toEqual([
      { kind: 'graded-uploads', minScorePercent: 60, uploads: [] },
    ]);
    expect(assessment.assessedItems).toEqual([]);
    expect(assessment.scoreBand).toBeUndefined();
  });

  it('ignores assignments without the criterion', () => {
    const { met, assessment } = evaluate(
      DEFAULT_CERTIFICATE_CRITERIA,
      [assignment('a')],
      [],
    );
    expect(met).toBe(true);
    expect(assessment.assessedItems).toEqual([]);
  });
});

describe('setCertificateCriteria', () => {
  const course = (requireQuizPass: boolean, version = 1) => ({
    courseId: 'c1',
    certificateCriteria: { version, requireQuizPass },
  });
  const set = (coreTable: CoreTable, requireQuizPass: boolean) =>
    setCertificateCriteria({
      coreTable,
      courseId: 'c1',
      criteria: { requireQuizPass },
    });

  it('bumps the version by one when the values change', async () => {
    const { coreTable, state } = fakeCourseTable(course(false));

    const updated = await set(coreTable, true);

    expect(updated.certificateCriteria).toEqual({
      version: 2,
      requireQuizPass: true,
    });
    expect(state.patches).toBe(1);
  });

  it('writes nothing when the values are the stored ones', async () => {
    const { coreTable, state } = fakeCourseTable(course(true, 3));

    const same = await set(coreTable, true);

    expect(same.certificateCriteria.version).toBe(3);
    expect(state.patches).toBe(0);
  });

  it('retries once from a fresh read when the version moved', async () => {
    // Two other changes land first: on, then off again (version 3).
    const { coreTable, state } = fakeCourseTable(course(false), (s) => {
      s.course = course(false, 3);
    });

    const updated = await set(coreTable, true);

    expect(updated.certificateCriteria).toEqual({
      version: 4,
      requireQuizPass: true,
    });
    expect(state.patches).toBe(2);
  });

  it('ends with one change when a concurrent one made the same change', async () => {
    const { coreTable, state } = fakeCourseTable(course(false), (s) => {
      s.course = course(true, 2);
    });

    const result = await set(coreTable, true);

    expect(result.certificateCriteria.version).toBe(2);
    expect(state.patches).toBe(1);
  });

  it('throws when the version moves again on the retry', async () => {
    let version = 1;
    const { coreTable } = fakeCourseTable(
      course(false),
      (s) => {
        s.course = course(false, ++version);
      },
      true,
    );

    await expect(set(coreTable, true)).rejects.toThrow(VersionConflictError);
  });

  it('sets and removes the upload score, bumping the version each time', async () => {
    const { coreTable } = fakeCourseTable(course(false));

    const set60 = await setCertificateCriteria({
      coreTable,
      courseId: 'c1',
      criteria: { requireQuizPass: false, minUploadScorePercent: 60 },
    });
    expect(set60.certificateCriteria).toEqual({
      version: 2,
      requireQuizPass: false,
      minUploadScorePercent: 60,
    });
    const kept = await set(coreTable, false);
    expect(kept.certificateCriteria.version).toBe(2);
    const cleared = await setCertificateCriteria({
      coreTable,
      courseId: 'c1',
      criteria: { requireQuizPass: false, minUploadScorePercent: null },
    });
    expect(cleared.certificateCriteria).toEqual({
      version: 3,
      requireQuizPass: false,
    });
  });

  it('refuses an upload score outside 1 to 100', async () => {
    const { coreTable, state } = fakeCourseTable(course(false));
    await expect(
      setCertificateCriteria({
        coreTable,
        courseId: 'c1',
        criteria: { requireQuizPass: false, minUploadScorePercent: 101 },
      }),
    ).rejects.toThrow('1 to 100');
    expect(state.patches).toBe(0);
  });

  it('throws when the course is missing', async () => {
    const { coreTable } = fakeCourseTable(undefined);

    await expect(set(coreTable, true)).rejects.toThrow('not found');
  });
});
