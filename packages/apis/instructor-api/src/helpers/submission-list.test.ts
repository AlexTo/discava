/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  type ListedEnrolment,
  type ListedSubmission,
  PAGE_SIZE,
  submissionList,
} from './submission-list.js';

const enrolment = (
  userId: string,
  status: ListedEnrolment['status'] = 'active',
): ListedEnrolment => ({ userId, status });

const submission = (
  userId: string,
  status: ListedSubmission['status'],
  submittedAt = '2026-11-10T00:00:00.000Z',
  extra: Partial<ListedSubmission> = {},
): ListedSubmission => ({
  userId,
  status,
  submittedAt,
  version: 1,
  late: false,
  ...extra,
});

const ids = (rows: { userId: string }[]) => rows.map((r) => r.userId);

describe('submissionList', () => {
  it('orders waiting work oldest first, then requests, returned, not submitted, then students who left', () => {
    const list = submissionList(
      [
        enrolment('a'),
        enrolment('b'),
        enrolment('c'),
        enrolment('d'),
        enrolment('e'),
        enrolment('f'),
        enrolment('g', 'dropped'),
      ],
      [
        submission('a', 'returned', '2026-11-01T00:00:00.000Z', {
          points: 8,
          pointsOutOf: 10,
        }),
        submission('b', 'submitted', '2026-11-05T00:00:00.000Z'),
        submission('c', 'resubmission_requested'),
        submission('d', 'submitted', '2026-11-02T00:00:00.000Z', {
          late: true,
        }),
        submission('g', 'submitted', '2026-11-01T00:00:00.000Z'),
      ],
    );

    expect(ids(list.rows)).toEqual(['d', 'b', 'c', 'a', 'e', 'f', 'g']);
    expect(list.rows.map((r) => r.state)).toEqual([
      'submitted',
      'submitted',
      'resubmission_requested',
      'returned',
      'not_submitted',
      'not_submitted',
      'submitted',
    ]);
    expect(list.rows[0]).toMatchObject({ late: true, version: 1 });
    expect(list.rows[3]).toMatchObject({ points: 8, pointsOutOf: 10 });
    expect(list.rows[6]).toMatchObject({ enrolled: false });
  });

  it('counts the whole assignment, leaving students who left out of waiting', () => {
    const list = submissionList(
      [
        enrolment('a'),
        enrolment('b'),
        enrolment('c'),
        enrolment('d', 'dropped'),
      ],
      [
        submission('a', 'submitted'),
        submission('b', 'returned'),
        submission('d', 'submitted'),
      ],
    );

    expect(list.counts).toEqual({
      waiting: 1,
      resubmissionRequested: 0,
      returned: 1,
      notSubmitted: 1,
    });
  });

  it('does not list a dropped student without a submission', () => {
    const list = submissionList(
      [enrolment('a'), enrolment('d', 'dropped')],
      [],
    );

    expect(ids(list.rows)).toEqual(['a']);
  });

  it('lists a dropped student with a submission last, read-only', () => {
    const list = submissionList(
      [enrolment('d', 'dropped'), enrolment('a')],
      [submission('d', 'returned')],
    );

    expect(list.rows.at(-1)).toMatchObject({
      userId: 'd',
      enrolled: false,
      state: 'returned',
    });
    expect(list.counts.returned).toBe(1);
  });

  it('breaks ties by user id', () => {
    const list = submissionList(
      [enrolment('c'), enrolment('a'), enrolment('b')],
      [
        submission('c', 'submitted'),
        submission('a', 'submitted'),
        submission('b', 'submitted'),
      ],
    );

    expect(ids(list.rows)).toEqual(['a', 'b', 'c']);
  });

  describe('pages', () => {
    const many = Array.from(
      { length: PAGE_SIZE + 10 },
      (_, i) => `u${String(i).padStart(3, '0')}`,
    );
    const enrolments = many.map((id) => enrolment(id));
    const submissions = many.map((id, i) =>
      submission(
        id,
        'submitted',
        `2026-11-10T00:${String(i % 60).padStart(2, '0')}:00.000Z`,
      ),
    );

    it('holds PAGE_SIZE rows and continues from the cursor to the end', () => {
      const first = submissionList(enrolments, submissions);
      const second = submissionList(enrolments, submissions, first.nextCursor);

      expect(first.rows).toHaveLength(PAGE_SIZE);
      expect(first.nextCursor).toBeDefined();
      expect(second.rows).toHaveLength(10);
      expect(second.nextCursor).toBeUndefined();
      expect(new Set([...ids(first.rows), ...ids(second.rows)]).size).toBe(
        PAGE_SIZE + 10,
      );
    });

    it('skips nothing when a row before the cursor changes state', () => {
      const first = submissionList(enrolments, submissions);
      const returned = submissions.map((s) =>
        s.userId === first.rows[0]!.userId
          ? { ...s, status: 'returned' as const }
          : s,
      );

      const second = submissionList(enrolments, returned, first.nextCursor);

      // The next page is as it was; the returned row now sorts after the
      // cursor, so it is listed again where it belongs, once.
      expect(ids(second.rows)).toEqual([
        ...ids(submissionList(enrolments, submissions, first.nextCursor).rows),
        first.rows[0]!.userId,
      ]);
    });

    it('starts from the top for a cursor that is not ours', () => {
      expect(submissionList(enrolments, submissions, 'nonsense').rows).toEqual(
        submissionList(enrolments, submissions).rows,
      );
    });
  });
});
