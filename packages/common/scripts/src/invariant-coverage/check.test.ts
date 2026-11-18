/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  checkInvariantCoverage,
  failureMessage,
  findTriggers,
  INVARIANTS_PATH,
  sameWriterMap,
  WAIVER_LABEL,
  type WriterMap,
} from './check.js';

const before: WriterMap = {
  enrolment: {
    'core-api': ['core-api/enrolment.ts'],
    'core-table': ['core-table/student-activity.ts'],
  },
  lesson: { 'instructor-api': ['instructor-api/lesson.ts'] },
  quizAttempt: { 'core-api': ['core-api/quiz.ts'] },
};

const withWriter = (
  map: WriterMap,
  entity: string,
  writer: string,
  file: string,
): WriterMap => ({
  ...map,
  [entity]: {
    ...map[entity],
    [writer]: [...(map[entity]?.[writer] ?? []), file],
  },
});

describe('findTriggers', () => {
  it('finds nothing when the writers are unchanged', () => {
    expect(findTriggers(before, before)).toEqual([]);
  });

  it('flags a new entity', () => {
    expect(findTriggers(before, { ...before, review: {} })).toEqual([
      { entity: 'review', reason: 'is a new entity' },
    ]);
  });

  it('flags an entity gaining a second writing package', () => {
    const after = withWriter(before, 'lesson', 'events', 'events/x.ts');
    expect(findTriggers(before, after)).toEqual([
      {
        entity: 'lesson',
        reason: 'is now written by events as well as instructor-api',
      },
    ]);
  });

  it('flags a core-table helper starting to write an entity an API writes', () => {
    const after = withWriter(
      before,
      'quizAttempt',
      'core-table',
      'core-table/quiz.ts',
    );
    expect(findTriggers(before, after)).toEqual([
      {
        entity: 'quizAttempt',
        reason: 'is now written by core-table as well as core-api',
      },
    ]);
  });

  it('flags a new file writing an entity shared by several packages', () => {
    const after = withWriter(
      before,
      'enrolment',
      'core-api',
      'core-api/new-procedure.ts',
    );
    expect(findTriggers(before, after)).toEqual([
      {
        entity: 'enrolment',
        reason:
          'is written by core-api, core-table, and now also directly by core-api/new-procedure.ts',
      },
    ]);
  });

  it('lets a new core-table helper write a shared entity', () => {
    const after = withWriter(
      before,
      'enrolment',
      'core-table',
      'core-table/new-helper.ts',
    );
    expect(findTriggers(before, after)).toEqual([]);
  });

  it('lets one package keep adding writers of an entity only it writes', () => {
    const after = withWriter(
      before,
      'lesson',
      'instructor-api',
      'instructor-api/module.ts',
    );
    expect(findTriggers(before, after)).toEqual([]);
  });

  it('ignores a writer going away', () => {
    const after: WriterMap = {
      ...before,
      enrolment: { 'core-table': ['core-table/student-activity.ts'] },
    };
    expect(findTriggers(before, after)).toEqual([]);
  });
});

describe('checkInvariantCoverage', () => {
  const triggers = [{ entity: 'lesson', reason: 'is now written by events' }];

  it('passes when nothing triggered', () => {
    expect(checkInvariantCoverage([], [], [])).toEqual({
      ok: true,
      reason: 'no entity gained a writer',
    });
  });

  it('passes when invariants.ts changed', () => {
    expect(
      checkInvariantCoverage(triggers, ['a.ts', INVARIANTS_PATH], []).ok,
    ).toBe(true);
  });

  it('passes when waived', () => {
    expect(checkInvariantCoverage(triggers, [], [WAIVER_LABEL]).ok).toBe(true);
  });

  it('fails otherwise, naming what triggered it', () => {
    const verdict = checkInvariantCoverage(triggers, ['a.ts'], ['other']);
    expect(verdict).toEqual({ ok: false, triggers });
    expect(failureMessage(triggers)).toContain(
      '  - lesson is now written by events',
    );
  });
});

describe('sameWriterMap', () => {
  it('ignores key and file order', () => {
    expect(
      sameWriterMap(
        { a: { x: ['2', '1'], y: [] }, b: {} },
        { b: {}, a: { y: [], x: ['1', '2'] } },
      ),
    ).toBe(true);
  });

  it('notices a file added', () => {
    expect(sameWriterMap({ a: { x: ['1'] } }, { a: { x: ['1', '2'] } })).toBe(
      false,
    );
  });
});
