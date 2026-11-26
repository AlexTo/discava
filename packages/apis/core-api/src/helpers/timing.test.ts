/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { Logger } from '@aws-lambda-powertools/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { timed } from './timing.js';

const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

// Resolves with `value`, or rejects with `error`, after `ms` of fake time.
const resolveAfter = <T>(ms: number, value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));
const rejectAfter = (ms: number, error: Error): Promise<never> =>
  new Promise((_, reject) => setTimeout(() => reject(error), ms));

describe('timed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    warn.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('returns the result of a fast step without logging', async () => {
    const result = timed('fast', resolveAfter(999, 'done'));
    await vi.advanceTimersByTimeAsync(999);

    await expect(result).resolves.toBe('done');
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs a step that takes a second or more', async () => {
    const result = timed('slow', resolveAfter(1_000, 'done'));
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(result).resolves.toBe('done');
    expect(warn).toHaveBeenCalledWith('Slow step', {
      step: 'slow',
      durationMs: 1_000,
    });
  });

  it('logs a slow step that fails, and lets the error through', async () => {
    const error = timed(
      'slow failure',
      rejectAfter(1_500, new Error('boom')),
    ).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_500);

    expect(await error).toEqual(new Error('boom'));
    expect(warn).toHaveBeenCalledWith('Slow step', {
      step: 'slow failure',
      durationMs: 1_500,
    });
  });
});
