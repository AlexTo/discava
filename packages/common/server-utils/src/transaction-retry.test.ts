/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_TRANSACTION_ATTEMPTS,
  retryTransaction,
} from './transaction-retry.js';

const noWait = () => vi.fn(async (_ceilingMs: number) => {});

describe('retryTransaction', () => {
  it('returns the value of a first attempt without waiting', async () => {
    const wait = noWait();
    const attempt = vi.fn(async () => ({ committed: true as const, value: 1 }));
    await expect(retryTransaction(attempt, { wait })).resolves.toBe(1);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('returns the result of a later attempt', async () => {
    const wait = noWait();
    let calls = 0;
    const attempt = async () =>
      ++calls < 4
        ? { committed: false as const }
        : { committed: true as const, value: 'done' };
    await expect(retryTransaction(attempt, { wait })).resolves.toBe('done');
    expect(calls).toBe(4);
    expect(wait).toHaveBeenCalledTimes(3);
  });

  it('ends in CONFLICT after all the attempts, waiting between them', async () => {
    const wait = noWait();
    const attempt = vi.fn(async () => ({ committed: false as const }));
    await expect(retryTransaction(attempt, { wait })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(attempt).toHaveBeenCalledTimes(MAX_TRANSACTION_ATTEMPTS);
    expect(MAX_TRANSACTION_ATTEMPTS).toBeGreaterThanOrEqual(6);
    // No wait after the last attempt.
    expect(wait).toHaveBeenCalledTimes(MAX_TRANSACTION_ATTEMPTS - 1);
  });

  it('doubles the ceiling of the wait, up to a cap', async () => {
    const wait = noWait();
    await expect(
      retryTransaction(async () => ({ committed: false }), {
        maxAttempts: 10,
        wait,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const ceilings = wait.mock.calls.map(([ms]) => ms);
    expect(ceilings.slice(0, 3)).toEqual([25, 50, 100]);
    expect(Math.max(...ceilings)).toBeLessThanOrEqual(800);
    expect(ceilings.every((ms, i) => i === 0 || ms >= ceilings[i - 1]!)).toBe(
      true,
    );
  });

  it('really waits, by a random time under the ceiling', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const result = retryTransaction(async () =>
        ++calls < 2
          ? { committed: false as const }
          : { committed: true as const, value: 'ok' },
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(25);
      await expect(result).resolves.toBe('ok');
    } finally {
      vi.useRealTimers();
    }
  });
});
