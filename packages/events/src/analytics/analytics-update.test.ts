/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import type { AnalyticsChange } from '@discava/core-table';
import { describe, expect, it, vi } from 'vitest';
import { analyticsUpdate } from './analytics-update.js';

type Event = Parameters<typeof analyticsUpdate>[0];

let sequence = 0;
const record = (
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
  entity: string,
  oldImage?: Record<string, unknown>,
  newImage?: Record<string, unknown>,
  eventID = `event-${++sequence}`,
) => ({
  eventID,
  eventName,
  dynamodb: {
    OldImage: oldImage && { __edb_e__: entity, ...oldImage },
    NewImage: newImage && { __edb_e__: entity, ...newImage },
  },
});
const batch = (...records: ReturnType<typeof record>[]) =>
  ({ Records: records }) as unknown as Event;

const enrolment = (overrides: Record<string, unknown> = {}) => ({
  courseId: 'c1',
  userId: 'u1',
  status: 'active',
  createdAt: '2026-11-16T10:00:00.000Z',
  ...overrides,
});

// An in-memory stand-in for applyAnalyticsChange (which core-table tests
// against its transactions): marks each event, ignores one it has marked, and
// adds a change's counts. A change's members are counted once per period.
const memoryApply = (failFor?: (change: AnalyticsChange) => boolean) => {
  const seen = new Set<string>();
  const counters = new Map<string, number>();
  const bump = (key: string, amount: number) =>
    counters.set(key, (counters.get(key) ?? 0) + amount);
  const apply = vi.fn(async (change: AnalyticsChange) => {
    if (failFor?.(change)) {
      throw new Error('write failed');
    }
    if (change.counts.length > 0) {
      if (seen.has(`event ${change.eventId}`)) {
        return 'already-applied' as const;
      }
      seen.add(`event ${change.eventId}`);
      for (const { courseId, sk, attribute, amount } of change.counts) {
        bump(`${courseId} ${sk} ${attribute}`, amount);
      }
    }
    let fresh = change.counts.length > 0;
    for (const { courseId, period, userId } of change.members) {
      if (!seen.has(`member ${courseId} ${period} ${userId}`)) {
        seen.add(`member ${courseId} ${period} ${userId}`);
        bump(`${courseId} ${period} activeLearners`, 1);
        fresh = true;
      }
    }
    return fresh ? ('applied' as const) : ('already-applied' as const);
  });
  return { apply, counters: () => Object.fromEntries(counters) };
};

describe('analyticsUpdate', () => {
  it('turns enrolment inserts and status changes into counts', async () => {
    const { apply, counters } = memoryApply();
    await analyticsUpdate(
      batch(
        record('INSERT', 'enrolment', undefined, enrolment()),
        record('INSERT', 'enrolment', undefined, enrolment({ userId: 'u2' })),
        record(
          'MODIFY',
          'enrolment',
          enrolment(),
          enrolment({ status: 'completed' }),
        ),
      ),
      apply,
    );
    expect(counters()).toEqual({
      'c1 SUMMARY enrolments': 2,
      'c1 SUMMARY completed': 1,
      'c1 DAY#2026-11-16 enrolments': 2,
    });
  });

  it('uses the record eventID as the marker of its change', async () => {
    const { apply } = memoryApply();
    await analyticsUpdate(
      batch(record('INSERT', 'enrolment', undefined, enrolment(), 'abc')),
      apply,
    );
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'abc', courseId: 'c1' }),
    );
  });

  it('leaves the counts as after once when the batch is delivered twice', async () => {
    const { apply, counters } = memoryApply();
    const records = batch(
      record('INSERT', 'enrolment', undefined, enrolment()),
      record('INSERT', 'itemCompletion', undefined, {
        courseId: 'c1',
        userId: 'u1',
        completedAt: '2026-11-17T09:00:00.000Z',
      }),
    );
    await analyticsUpdate(records, apply);
    const once = counters();
    const second = await analyticsUpdate(records, apply);
    expect(counters()).toEqual(once);
    expect(second.applied).toBe(0);
  });

  it('applies the others, then throws, when one write fails; the redelivery changes nothing already applied', async () => {
    const records = batch(
      record('INSERT', 'enrolment', undefined, enrolment({ courseId: 'c1' })),
      record('INSERT', 'enrolment', undefined, enrolment({ courseId: 'c2' })),
    );
    let failing = true;
    const { apply, counters } = memoryApply(
      (change) => failing && change.courseId === 'c2',
    );
    await expect(analyticsUpdate(records, apply)).rejects.toThrow(
      'write failed',
    );
    expect(counters()).toEqual({
      'c1 SUMMARY enrolments': 1,
      'c1 DAY#2026-11-16 enrolments': 1,
    });

    failing = false;
    await analyticsUpdate(records, apply);
    expect(counters()).toEqual({
      'c1 SUMMARY enrolments': 1,
      'c1 DAY#2026-11-16 enrolments': 1,
      'c2 SUMMARY enrolments': 1,
      'c2 DAY#2026-11-16 enrolments': 1,
    });
  });

  // The router delivers at least once and unordered.
  it('gives the same counts for records in reverse order', async () => {
    const created = enrolment();
    const completed = enrolment({ status: 'completed' });
    const dropped = enrolment({ status: 'dropped' });
    const records = [
      record('INSERT', 'enrolment', undefined, created),
      record('MODIFY', 'enrolment', created, completed),
      record('MODIFY', 'enrolment', completed, dropped),
    ];
    const inOrder = memoryApply();
    await analyticsUpdate(batch(...records), inOrder.apply);
    const reversed = memoryApply();
    await analyticsUpdate(batch(...[...records].reverse()), reversed.apply);
    expect(reversed.counters()).toEqual(inOrder.counters());
    expect(inOrder.counters()).toMatchObject({
      'c1 SUMMARY enrolments': 1,
      'c1 SUMMARY dropped': 1,
      'c1 SUMMARY completed': 0,
    });
  });

  it('gives the same counts when two changes to one record are swapped', async () => {
    const a = enrolment();
    const b = enrolment({ status: 'completed' });
    const c = enrolment({ status: 'dropped' });
    const first = record('MODIFY', 'enrolment', a, b);
    const second = record('MODIFY', 'enrolment', b, c);
    const x = memoryApply();
    await analyticsUpdate(batch(first, second), x.apply);
    const y = memoryApply();
    await analyticsUpdate(batch(second, first), y.apply);
    expect(y.counters()).toEqual(x.counters());
  });

  it('subtracts a removed enrolment', async () => {
    const { apply, counters } = memoryApply();
    await analyticsUpdate(
      batch(
        record('INSERT', 'enrolment', undefined, enrolment()),
        record('REMOVE', 'enrolment', enrolment(), undefined),
      ),
      apply,
    );
    expect(counters()['c1 SUMMARY enrolments']).toBe(0);
  });

  it('applies records of different courses independently', async () => {
    const { apply, counters } = memoryApply();
    await analyticsUpdate(
      batch(
        record('INSERT', 'enrolment', undefined, enrolment({ courseId: 'c1' })),
        record('INSERT', 'enrolment', undefined, enrolment({ courseId: 'c2' })),
        record('INSERT', 'enrolment', undefined, enrolment({ courseId: 'c2' })),
      ),
      apply,
    );
    expect(counters()['c1 SUMMARY enrolments']).toBe(1);
    expect(counters()['c2 SUMMARY enrolments']).toBe(2);
  });

  it('applies the records of one course one after the other', async () => {
    let running = 0;
    let overlapped = false;
    const apply = vi.fn(async () => {
      running++;
      overlapped ||= running > 1;
      await new Promise((resolve) => setTimeout(resolve, 1));
      running--;
      return 'applied' as const;
    });
    await analyticsUpdate(
      batch(
        record('INSERT', 'enrolment', undefined, enrolment()),
        record('INSERT', 'enrolment', undefined, enrolment({ userId: 'u2' })),
      ),
      apply,
    );
    expect(overlapped).toBe(false);
  });

  it('counts a learner once a day however many records they leave', async () => {
    const { apply, counters } = memoryApply();
    const completion = (completedAt: string) =>
      record('INSERT', 'itemCompletion', undefined, {
        courseId: 'c1',
        userId: 'u1',
        completedAt,
      });
    await analyticsUpdate(
      batch(
        completion('2026-11-17T08:00:00.000Z'),
        completion('2026-11-17T09:00:00.000Z'),
        completion('2026-11-18T09:00:00.000Z'),
      ),
      apply,
    );
    expect(counters()).toEqual({
      'c1 DAY#2026-11-17 activeLearners': 1,
      'c1 DAY#2026-11-18 activeLearners': 1,
      'c1 WEEK#2026-W47 activeLearners': 1,
    });
  });

  it('ignores aggregate and marker records, and edits that change no figure', async () => {
    const { apply } = memoryApply();
    const result = await analyticsUpdate(
      batch(
        record('MODIFY', 'courseStats', { courseId: 'c1' }, { courseId: 'c1' }),
        record('INSERT', 'analyticsMarker', undefined, { courseId: 'c1' }),
        record(
          'MODIFY',
          'enrolment',
          enrolment({ progressPercent: 10 }),
          enrolment({ progressPercent: 50 }),
        ),
      ),
      apply,
    );
    expect(apply).not.toHaveBeenCalled();
    expect(result).toEqual({ applied: 0, skipped: 3 });
  });

  describe('lesson funnel', () => {
    const progress = (status: string, lessonId = 'l1') => ({
      courseId: 'c1',
      userId: 'u1',
      lessonId,
      status,
    });

    it('settles the lesson of a progress record, not applying its image as counts', async () => {
      const { apply } = memoryApply();
      const settle = vi.fn(async () => true);
      const result = await analyticsUpdate(
        batch(
          record('INSERT', 'progress', undefined, progress('in_progress')),
          record(
            'MODIFY',
            'progress',
            progress('in_progress'),
            progress('completed'),
          ),
        ),
        apply,
        settle,
      );
      expect(apply).not.toHaveBeenCalled();
      // The same lesson is settled once for the batch.
      expect(settle.mock.calls).toEqual([
        [{ courseId: 'c1', userId: 'u1', lessonId: 'l1' }],
      ]);
      expect(result).toEqual({ applied: 1, skipped: 0 });
    });

    it('settles all of a student’s lessons when their enrolment drops', async () => {
      const { apply } = memoryApply();
      const settle = vi.fn(async () => true);
      await analyticsUpdate(
        batch(
          record(
            'MODIFY',
            'enrolment',
            enrolment(),
            enrolment({ status: 'dropped' }),
          ),
        ),
        apply,
        settle,
      );
      expect(settle.mock.calls).toEqual([[{ courseId: 'c1', userId: 'u1' }]]);
      // The drop still counts on the summary.
      expect(apply).toHaveBeenCalledTimes(1);
    });

    it('retries the batch when settling fails, and still settles the rest', async () => {
      const { apply } = memoryApply();
      const settle = vi
        .fn()
        .mockRejectedValueOnce(new Error('conflict'))
        .mockResolvedValue(true);
      await expect(
        analyticsUpdate(
          batch(
            record(
              'INSERT',
              'progress',
              undefined,
              progress('completed', 'l1'),
            ),
            record(
              'INSERT',
              'progress',
              undefined,
              progress('completed', 'l2'),
            ),
          ),
          apply,
          settle,
        ),
      ).rejects.toThrow('conflict');
      expect(settle).toHaveBeenCalledTimes(2);
    });
  });
});
