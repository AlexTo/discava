/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { waitForQueue } from './wait-for-queue.js';

const depth = { visible: 0, inFlight: 0 };

describe('waitForQueue', () => {
  it('resolves at once when the queue service is already up', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    await waitForQueue({
      queue: { depth: vi.fn().mockResolvedValue(depth) },
      queueUrl: 'q',
      sleep,
    });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('keeps asking, logging once, until the queue service answers', async () => {
    const queueDepth = vi
      .fn()
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValue(depth);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();
    await waitForQueue({
      queue: { depth: queueDepth },
      queueUrl: 'q',
      intervalMs: 250,
      sleep,
      log,
    });
    expect(queueDepth).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      'waiting for the local queue service (connect ECONNREFUSED)',
    );
  });

  it('throws the last error once the attempts are used up', async () => {
    await expect(
      waitForQueue({
        queue: { depth: vi.fn().mockRejectedValue(new Error('still down')) },
        queueUrl: 'q',
        attempts: 3,
        sleep: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toThrow('still down');
  });

  it('stops quietly when aborted while waiting', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      waitForQueue({
        queue: { depth: vi.fn().mockRejectedValue(new Error('down')) },
        queueUrl: 'q',
        signal: controller.signal,
        sleep: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toBeUndefined();
  });
});
