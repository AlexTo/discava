/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addedLines,
  checkInvariantCoverage,
  failureMessage,
  findTriggers,
  INVARIANTS_PATH,
  sameWriterMap,
  snapshotKeys,
  WAIVER_LABEL,
  WRITER_MAP_PATH,
  type WriterMap,
} from './check.js';
import { WORKSPACE_ROOT } from './scan.js';

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
  const triggers = [
    { entity: 'enrolment', reason: 'is now written by events' },
    { entity: 'category', reason: 'is now written by core-api' },
  ];
  const snapshotKeys = { enrolment: 'enrolments', category: 'categories' };
  const change = (added: string[]) => ({ added, snapshotKeys });

  it('passes when nothing triggered', () => {
    expect(checkInvariantCoverage([], change([]), [])).toEqual({
      ok: true,
      reason: 'no entity gained a writer',
    });
  });

  it('passes when the invariants.ts change names every entity', () => {
    expect(
      checkInvariantCoverage(
        triggers,
        change([
          '  for (const e of snapshot.enrolments) {',
          '// 30. A category is only written by its helper.',
        ]),
        [],
      ),
    ).toEqual({
      ok: true,
      reason: `${INVARIANTS_PATH} changes for enrolment, category`,
    });
  });

  it('counts the factory name, capitalised', () => {
    expect(
      checkInvariantCoverage(
        triggers,
        change(['Item<typeof createEnrolmentEntity>', 'snapshot.categories']),
        [],
      ).ok,
    ).toBe(true);
  });

  it('fails for the entities the change does not name', () => {
    expect(
      checkInvariantCoverage(triggers, change(['snapshot.enrolments']), []),
    ).toEqual({ ok: false, triggers: [triggers[1]] });
  });

  it('does not count a longer word containing the name', () => {
    expect(
      checkInvariantCoverage(
        [{ entity: 'user', reason: 'is now written by events' }],
        { added: ['const { userId } = enrolment;'], snapshotKeys: {} },
        [],
      ).ok,
    ).toBe(false);
  });

  it('fails when invariants.ts did not change', () => {
    expect(checkInvariantCoverage(triggers, change([]), ['other'])).toEqual({
      ok: false,
      triggers,
    });
  });

  it('passes when waived', () => {
    expect(
      checkInvariantCoverage(triggers, change([]), [WAIVER_LABEL]).ok,
    ).toBe(true);
  });

  it('names what triggered it and the snapshot key to use', () => {
    const message = failureMessage(triggers, snapshotKeys);
    expect(message).toContain('  - enrolment is now written by events');
    expect(message).toContain('category: `snapshot.categories`');
  });
});

describe('snapshotKeys', () => {
  it("reads each entity's key from TableSnapshot", () => {
    expect(
      snapshotKeys(`export interface TableSnapshot {
  categories: Pick<Item<typeof createCategoryEntity>, 'categoryId'>[];
  quizSummaries: Pick<
    Item<typeof createQuizSummaryEntity>,
    'userId'
  >[];
}`),
    ).toEqual({ category: 'categories', quizSummary: 'quizSummaries' });
  });

  it('finds every entity but the markers in the real invariants.ts', () => {
    const keys = snapshotKeys(
      readFileSync(path.join(WORKSPACE_ROOT, INVARIANTS_PATH), 'utf8'),
    );
    const entities = Object.keys(
      JSON.parse(
        readFileSync(path.join(WORKSPACE_ROOT, WRITER_MAP_PATH), 'utf8'),
      ),
    );
    expect(entities.filter((entity) => !keys[entity])).toEqual([
      'analyticsMarker',
    ]);
  });
});

describe('addedLines', () => {
  it('keeps only the lines a diff adds', () => {
    expect(
      addedLines('--- a/x\n+++ b/x\n@@ -1 +1,2 @@\n-old\n+new\n same'),
    ).toEqual(['new']);
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
