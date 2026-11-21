/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { studentsToRecalculate } from './progress-recalculation.js';

type Record = Parameters<typeof studentsToRecalculate>[0][number];

const record = (
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
  oldImage?: { [key: string]: unknown },
  newImage?: { [key: string]: unknown },
) =>
  ({
    eventName,
    dynamodb: { OldImage: oldImage, NewImage: newImage },
  }) as unknown as Record;

const completion = (userId: string, courseId = 'course-1') =>
  record('INSERT', undefined, {
    __edb_e__: 'itemCompletion',
    userId,
    courseId,
  });

const curriculumChange = (
  before: { [key: string]: unknown },
  after: { [key: string]: unknown },
  entity = 'contentItem',
) =>
  record(
    'MODIFY',
    {
      __edb_e__: entity,
      courseId: 'course-1',
      visibility: 'visible',
      ...before,
    },
    {
      __edb_e__: entity,
      courseId: 'course-1',
      visibility: 'visible',
      ...after,
    },
  );

const asLists = (result: Map<string, Set<string>>) =>
  Object.fromEntries([...result].map(([course, ids]) => [course, [...ids]]));

describe('studentsToRecalculate', () => {
  const enrolled = vi.fn(async (courseId: string) =>
    courseId === 'course-1' ? ['s1', 's2'] : ['s3'],
  );

  it('recalculates the student of each completion, once', async () => {
    const result = await studentsToRecalculate(
      [completion('s1'), completion('s1'), completion('s4', 'course-2')],
      enrolled,
    );

    expect(asLists(result)).toEqual({ 'course-1': ['s1'], 'course-2': ['s4'] });
    expect(enrolled).not.toHaveBeenCalled();
  });

  it.each([
    ['hidden', { visibility: 'visible' }, { visibility: 'hidden' }],
    ['published', { visibility: 'hidden' }, { visibility: 'visible' }],
    ['archived', {}, { archivedAt: '2024-01-01' }],
    ['restored', { archivedAt: '2024-01-01' }, {}],
  ])(
    'recalculates everyone enrolled when a record is %s',
    async (_, before, after) => {
      const result = await studentsToRecalculate(
        [curriculumChange(before, after)],
        enrolled,
      );

      expect(asLists(result)).toEqual({ 'course-1': ['s1', 's2'] });
    },
  );

  it('recalculates everyone enrolled when a record is removed', async () => {
    const result = await studentsToRecalculate(
      [record('REMOVE', { __edb_e__: 'lesson', courseId: 'course-1' })],
      enrolled,
    );

    expect(asLists(result)).toEqual({ 'course-1': ['s1', 's2'] });
  });

  it('ignores edits that don’t change what students see', async () => {
    enrolled.mockClear();

    const result = await studentsToRecalculate(
      [
        curriculumChange({ title: 'Old' }, { title: 'New' }),
        curriculumChange({ order: 1 }, { order: 2 }, 'module'),
        curriculumChange(
          { studentActivityCount: 0 },
          { studentActivityCount: 1 },
        ),
      ],
      enrolled,
    );

    expect(asLists(result)).toEqual({});
    expect(enrolled).not.toHaveBeenCalled();
  });

  // Captions are written to the content item, so their records pass the
  // stream filter (every content item edit does) and are ignored here.
  it('ignores caption writes: pending after a transcode, a track added, a failure', async () => {
    enrolled.mockClear();
    const track = {
      trackId: 't1',
      nonce: 'n1',
      language: 'en-US',
      label: 'English',
      source: 'auto',
      key: 'folder/n1/captions/t1.vtt',
      isDefault: true,
    };

    const result = await studentsToRecalculate(
      [
        curriculumChange(
          { captionsStatus: 'pending', captionsPendingSince: 'then' },
          {
            captionsStatus: 'ready',
            captionTracks: [track],
            captionTracksRev: 1,
          },
        ),
        curriculumChange(
          { captionsStatus: 'pending' },
          { captionsStatus: 'failed' },
        ),
        curriculumChange(
          { captionTracks: [track], captionTracksRev: 1 },
          { captionTracks: [], captionTracksRev: 2 },
        ),
      ],
      enrolled,
    );

    expect(asLists(result)).toEqual({});
    expect(enrolled).not.toHaveBeenCalled();
  });

  it('lists a course’s students once for a burst of changes, together with its completions', async () => {
    enrolled.mockClear();

    const result = await studentsToRecalculate(
      [
        curriculumChange({}, { visibility: 'hidden' }),
        curriculumChange({}, { archivedAt: '2024-01-01' }, 'lesson'),
        completion('s5'),
      ],
      enrolled,
    );

    expect(enrolled).toHaveBeenCalledTimes(1);
    expect(asLists(result)).toEqual({ 'course-1': ['s5', 's1', 's2'] });
  });

  it('ignores records of other entities', async () => {
    const result = await studentsToRecalculate(
      [
        record(
          'MODIFY',
          { __edb_e__: 'enrolment', courseId: 'course-1' },
          { __edb_e__: 'enrolment', courseId: 'course-1', progressPercent: 50 },
        ),
        record('INSERT', undefined, {
          __edb_e__: 'quizAttempt',
          courseId: 'course-1',
          userId: 's1',
        }),
      ],
      enrolled,
    );

    expect(asLists(result)).toEqual({});
  });

  // Queues deliver a message twice, or out of order: what is
  // recalculated depends on which records are in the batch, never on their
  // order or on how often one appears.
  describe('duplicate and reordered batches', () => {
    const batch = [
      completion('s1'),
      completion('s4', 'course-2'),
      curriculumChange({}, { visibility: 'hidden' }),
      curriculumChange({}, { archivedAt: '2024-01-01' }, 'lesson'),
      record('REMOVE', { __edb_e__: 'module', courseId: 'course-3' }),
    ];
    const asSets = (result: Map<string, Set<string>>) =>
      Object.fromEntries(
        [...result].map(([course, ids]) => [course, [...ids].sort()]),
      );
    const listStudents = async (courseId: string) =>
      courseId === 'course-1' ? ['s1', 's2'] : ['s7'];

    it('gives the same students when every record is delivered twice', async () => {
      const once = await studentsToRecalculate(batch, listStudents);
      const twice = await studentsToRecalculate(
        [...batch, ...batch],
        listStudents,
      );

      expect(asSets(twice)).toEqual(asSets(once));
    });

    it('gives the same students when the records arrive in reverse', async () => {
      const forward = await studentsToRecalculate(batch, listStudents);
      const backward = await studentsToRecalculate(
        [...batch].reverse(),
        listStudents,
      );

      expect(asSets(backward)).toEqual(asSets(forward));
    });

    it('gives the same students when a later record is delivered ahead of an earlier one', async () => {
      const hidden = curriculumChange({}, { visibility: 'hidden' });
      const shown = curriculumChange(
        { visibility: 'hidden' },
        { visibility: 'visible' },
      );

      const inOrder = await studentsToRecalculate(
        [hidden, shown],
        listStudents,
      );
      const swapped = await studentsToRecalculate(
        [shown, hidden],
        listStudents,
      );

      expect(asSets(swapped)).toEqual(asSets(inOrder));
    });
  });
});

describe('studentsToRecalculate for certificate criteria', () => {
  const enrolled = vi.fn(async () => ['s1', 's2']);
  const summary = (
    before: { [key: string]: unknown } | undefined,
    after: { [key: string]: unknown },
  ) =>
    record(
      before ? 'MODIFY' : 'INSERT',
      before && {
        __edb_e__: 'quizSummary',
        courseId: 'course-1',
        userId: 's1',
        ...before,
      },
      {
        __edb_e__: 'quizSummary',
        courseId: 'course-1',
        userId: 's1',
        ...after,
      },
    );
  const course = (
    before: { [key: string]: unknown },
    after: { [key: string]: unknown },
  ) =>
    record(
      'MODIFY',
      { __edb_e__: 'course', courseId: 'course-1', ...before },
      { __edb_e__: 'course', courseId: 'course-1', ...after },
    );
  const criteria = (version: number) => ({
    certificateCriteria: { version, requireQuizPass: true },
  });
  const quiz = (passMarkPercent: number) => ({
    type: 'quiz',
    settings: { passMarkPercent },
  });

  it('recalculates the student of a first pass or a better score on a passed quiz', async () => {
    enrolled.mockClear();
    const passed = { passedAt: '2026-01-01T00:00:00.000Z' };

    expect(
      asLists(
        await studentsToRecalculate([summary(undefined, passed)], enrolled),
      ),
    ).toEqual({ 'course-1': ['s1'] });
    expect(
      asLists(
        await studentsToRecalculate(
          [summary({ bestScore: 40 }, { bestScore: 90, ...passed })],
          enrolled,
        ),
      ),
    ).toEqual({ 'course-1': ['s1'] });
    // A later attempt that raises the best score of a quiz already passed.
    expect(
      asLists(
        await studentsToRecalculate(
          [summary({ bestScore: 70, ...passed }, { bestScore: 95, ...passed })],
          enrolled,
        ),
      ),
    ).toEqual({ 'course-1': ['s1'] });
    // A failing attempt, and a second pass that doesn't raise the best score.
    expect(
      asLists(
        await studentsToRecalculate(
          [
            summary(undefined, { bestScore: 10 }),
            summary({ bestScore: 95, ...passed }, { bestScore: 95, ...passed }),
          ],
          enrolled,
        ),
      ),
    ).toEqual({});
    expect(enrolled).not.toHaveBeenCalled();
  });

  it('recalculates everyone enrolled when the criteria or the switch changes', async () => {
    for (const [before, after] of [
      [criteria(1), criteria(2)],
      [{ certificatesEnabled: true }, { certificatesEnabled: false }],
      [{ certificatesEnabled: false }, { certificatesEnabled: true }],
    ]) {
      expect(
        asLists(await studentsToRecalculate([course(before, after)], enrolled)),
      ).toEqual({ 'course-1': ['s1', 's2'] });
    }
  });

  it('ignores a course edit that leaves the criteria and the switch alone', async () => {
    enrolled.mockClear();

    const result = await studentsToRecalculate(
      [
        course(
          { title: 'Old', ...criteria(1) },
          { title: 'New', ...criteria(1) },
        ),
      ],
      enrolled,
    );

    expect(asLists(result)).toEqual({});
    expect(enrolled).not.toHaveBeenCalled();
  });

  it.each([
    ['70 to 0', 70, 0, true],
    ['0 to 70', 0, 70, true],
    ['70 to 80', 70, 80, true],
    ['80 to 60', 80, 60, true],
    ['70 to 70', 70, 70, false],
  ])(
    'a quiz pass mark changed %s recalculates everyone enrolled: %s',
    async (_, from, to, recalculated) => {
      const result = await studentsToRecalculate(
        [curriculumChange(quiz(from), quiz(to))],
        enrolled,
      );

      expect(asLists(result)).toEqual(
        recalculated ? { 'course-1': ['s1', 's2'] } : {},
      );
    },
  );

  it('ignores a settings edit of an item that is not a quiz', async () => {
    const result = await studentsToRecalculate(
      [
        curriculumChange(
          { type: 'text', settings: { passMarkPercent: 70 } },
          { type: 'text', settings: { passMarkPercent: 0 } },
        ),
      ],
      enrolled,
    );

    expect(asLists(result)).toEqual({});
  });

  it('recalculates a student once when a batch names them several ways', async () => {
    const result = await studentsToRecalculate(
      [
        summary(undefined, { passedAt: '2026-01-01T00:00:00.000Z' }),
        course(criteria(1), criteria(2)),
        completion('s1'),
      ],
      enrolled,
    );

    expect([...(result.get('course-1') ?? [])].sort()).toEqual(['s1', 's2']);
  });
});
