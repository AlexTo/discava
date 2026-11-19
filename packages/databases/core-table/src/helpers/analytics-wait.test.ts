/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForAnalytics } from './analytics-wait.js';
import type { InvariantViolation } from './invariants/index.js';

const violation: InvariantViolation = {
  invariant: 'analytics-matches-records',
  message: 'enrolments is 0, but its records add up to 1',
  record: { courseId: 'c1', item: 'SUMMARY' },
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('waitForAnalytics', () => {
  it('reads once when the analytics already match', async () => {
    const read = vi.fn(async () => []);
    await expect(waitForAnalytics({ read })).resolves.toEqual([]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('reads again, a second apart, until they match', async () => {
    const read = vi
      .fn<() => Promise<InvariantViolation[]>>()
      .mockResolvedValueOnce([violation])
      .mockResolvedValueOnce([violation])
      .mockResolvedValue([]);
    const waiting = waitForAnalytics({ read });

    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(waiting).resolves.toEqual([]);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('reports the violation still there after 30 seconds', async () => {
    const read = vi.fn(async () => [violation]);
    const waiting = waitForAnalytics({ read });
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(waiting).resolves.toEqual([violation]);
    // The first read, then one a second for 30 seconds.
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(30);
    expect(read.mock.calls.length).toBeLessThanOrEqual(32);
  });

  it('takes the time and interval it is given', async () => {
    const read = vi.fn(async () => [violation]);
    const waiting = waitForAnalytics({ read, timeoutMs: 100, intervalMs: 40 });
    await vi.advanceTimersByTimeAsync(200);
    await expect(waiting).resolves.toEqual([violation]);
    expect(read).toHaveBeenCalledTimes(4);
  });
});
