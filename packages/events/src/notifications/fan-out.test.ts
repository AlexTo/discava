/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fanOutBroadcast } from './fan-out.js';

const publishNotification = vi.hoisted(() => vi.fn());
vi.mock('@discava/core-table', () => ({ publishNotification }));

type Enrolment = { userId: string; status: string };

// A fake core table: enrolments paged by the real page size the caller asks
// for, with the cursor being the next offset.
const fakeTable = (
  enrolments: Enrolment[],
  broadcast: Record<string, unknown> | null = {},
) => {
  const state: Record<string, unknown> | undefined = broadcast
    ? {
        id: 'b1',
        type: 'announcement.posted',
        courseId: 'c1',
        params: { courseId: 'c1' },
        dedupeKey: 'k',
        occurredAt: '2026-11-17T00:00:00.000Z',
        status: 'pending',
        ...broadcast,
      }
    : undefined;
  const patches: Record<string, unknown>[] = [];
  const query = vi.fn(
    async ({ limit, cursor }: { limit: number; cursor?: string }) => {
      const from = cursor ? Number(cursor) : 0;
      const data = enrolments.slice(from, from + limit);
      const next = from + limit;
      return {
        data,
        cursor: next < enrolments.length ? String(next) : null,
      };
    },
  );
  const table = {
    entities: {
      notificationBroadcast: {
        get: () => ({ go: async () => ({ data: state }) }),
        patch: () => ({
          set: (values: Record<string, unknown>) => ({
            go: async () => {
              patches.push(values);
              Object.assign(state ?? {}, values);
            },
          }),
        }),
      },
      enrolment: {
        query: {
          primary: () => ({
            go: (options: { limit: number; cursor?: string }) => query(options),
          }),
        },
      },
    },
  };
  return { table: table as never, patches, query, state };
};

const students = (count: number, status = 'active'): Enrolment[] =>
  Array.from({ length: count }, (_, i) => ({ userId: `u${i}`, status }));

const notified = () =>
  publishNotification.mock.calls.map(([, input]) => input.userId);

beforeEach(() => {
  publishNotification.mockReset();
  publishNotification.mockResolvedValue('created');
});

describe('fanOutBroadcast', () => {
  it('notifies every active and completed student once and marks it done', async () => {
    const { table, patches } = fakeTable([
      { userId: 'a', status: 'active' },
      { userId: 'b', status: 'completed' },
    ]);
    const result = await fanOutBroadcast(table, 'b1');
    expect(notified().sort()).toEqual(['a', 'b']);
    expect(result).toMatchObject({ created: 2, duplicates: 0 });
    expect(patches.at(-1)).toMatchObject({
      status: 'done',
      completedAt: expect.any(String),
    });
    expect(publishNotification.mock.calls[0][1]).toMatchObject({
      type: 'announcement.posted',
      params: { courseId: 'c1' },
      dedupeKey: 'k',
      occurredAt: '2026-11-17T00:00:00.000Z',
    });
  });

  it('skips a dropped student', async () => {
    const { table } = fakeTable([
      { userId: 'a', status: 'active' },
      { userId: 'gone', status: 'dropped' },
    ]);
    await fanOutBroadcast(table, 'b1');
    expect(notified()).toEqual(['a']);
  });

  it('does nothing for a broadcast that is done', async () => {
    const { table, query } = fakeTable(students(3), { status: 'done' });
    const result = await fanOutBroadcast(table, 'b1');
    expect(result.alreadyDone).toBe(true);
    expect(query).not.toHaveBeenCalled();
    expect(publishNotification).not.toHaveBeenCalled();
  });

  it('does nothing for a broadcast that does not exist', async () => {
    const { table } = fakeTable(students(3), null);
    await fanOutBroadcast(table, 'b1');
    expect(publishNotification).not.toHaveBeenCalled();
  });

  it('treats duplicate results as success', async () => {
    publishNotification.mockResolvedValue('duplicate');
    const { table, patches } = fakeTable(students(3));
    const result = await fanOutBroadcast(table, 'b1');
    expect(result).toMatchObject({ created: 0, duplicates: 3 });
    expect(patches.at(-1)).toMatchObject({ status: 'done' });
  });

  it('resumes from the saved cursor after a failure, without re-notifying page 1', async () => {
    const { table, state } = fakeTable(students(250));
    publishNotification.mockImplementation(async (_, { userId }) => {
      if (userId === 'u150') {
        throw new Error('boom');
      }
      return 'created';
    });
    await expect(fanOutBroadcast(table, 'b1')).rejects.toThrow('boom');
    expect(state?.cursor).toBe('100');
    expect(state?.status).toBe('pending');

    publishNotification.mockReset();
    publishNotification.mockResolvedValue('created');
    await fanOutBroadcast(table, 'b1');
    const retried = notified();
    expect(retried).toHaveLength(150);
    expect(retried).not.toContain('u0');
    expect(retried).not.toContain('u99');
    expect(retried).toContain('u100');
    expect(state?.status).toBe('done');
  });

  it('pages through 5,000 students', async () => {
    const { table, query } = fakeTable(students(5000));
    const result = await fanOutBroadcast(table, 'b1');
    expect(result.created).toBe(5000);
    expect(new Set(notified()).size).toBe(5000);
    expect(query).toHaveBeenCalledTimes(50);
  });

  it('publishes at most 10 at a time', async () => {
    const { table } = fakeTable(students(100));
    let running = 0;
    let peak = 0;
    publishNotification.mockImplementation(async () => {
      peak = Math.max(peak, ++running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running--;
      return 'created';
    });
    await fanOutBroadcast(table, 'b1');
    expect(peak).toBe(10);
  });
});
