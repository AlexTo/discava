/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { checkTableInvariants, violationId } from './index.js';
import { emptyTableSnapshot, type TableSnapshot } from './snapshot.js';
import {
  checkTableInvariants as checkConsistent,
  consistentTable,
} from './test-fixture.js';

let table: TableSnapshot;
beforeEach(() => {
  table = consistentTable();
});

describe('checkTableInvariants', () => {
  it('finds nothing wrong with a consistent table', () => {
    expect(checkConsistent(table)).toEqual([]);
  });

  it('finds nothing wrong with an empty table', () => {
    expect(checkTableInvariants(emptyTableSnapshot())).toEqual([]);
  });
});

describe('violationId', () => {
  it('is the same for the same violation found twice, and differs otherwise', () => {
    table.courseInstructors = [];
    const [first] = checkTableInvariants(table);
    const [again] = checkTableInvariants(table);
    expect(violationId(first)).toBe(violationId(again));
    expect(violationId({ ...first, record: { courseId: 'c2' } })).not.toBe(
      violationId(first),
    );
  });
});
