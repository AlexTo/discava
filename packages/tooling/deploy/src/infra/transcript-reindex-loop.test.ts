/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  parseReindexArgs,
  reindexUntilDone,
} from './transcript-reindex-loop.js';

const part = (cursor?: string) => ({
  courses: 1,
  items: 2,
  indexed: 3,
  removed: 1,
  ...(cursor && { cursor }),
});

describe('reindexUntilDone', () => {
  it('calls again with each cursor until none comes back, and sums the calls', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(part('0:c1'))
      .mockResolvedValueOnce(part('0:c2'))
      .mockResolvedValueOnce(part());

    const totals = await reindexUntilDone(invoke);

    expect(invoke.mock.calls.map(([event]) => event)).toEqual([
      {},
      { cursor: '0:c1' },
      { cursor: '0:c2' },
    ]);
    expect(totals).toEqual({
      calls: 3,
      courses: 3,
      items: 6,
      indexed: 9,
      removed: 3,
    });
  });

  it('passes the course on every call', async () => {
    const invoke = vi.fn().mockResolvedValue(part());

    await reindexUntilDone(invoke, 'c1');

    expect(invoke).toHaveBeenCalledWith({ courseId: 'c1' });
  });

  it('stops and rethrows when a call fails', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(part('0:c1'))
      .mockRejectedValueOnce(new Error('Lambda failed'));

    await expect(reindexUntilDone(invoke)).rejects.toThrow('Lambda failed');
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

describe('parseReindexArgs', () => {
  it('reads --stage and --course, ignoring a passed-through separator', () => {
    expect(
      parseReindexArgs(['--', '--stage=discava-development', '--course=c-1']),
    ).toEqual({ stage: 'discava-development', course: 'c-1' });
  });

  it('allows no arguments, for a local run', () => {
    expect(parseReindexArgs([])).toEqual({});
  });

  it('refuses a course that is not an id, and an unknown flag', () => {
    expect(() => parseReindexArgs(['--course=a b'])).toThrow('not a course id');
    expect(() => parseReindexArgs(['--nope'])).toThrow();
  });
});
