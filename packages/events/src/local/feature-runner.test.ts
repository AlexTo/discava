/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import type { StreamFeature } from '@discava/core-table';
import type { DynamoDBRecord } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { createFeatureRunner } from './feature-runner.js';
import { createInProcessQueue } from './in-process-queue.js';

const feature = (name: string, maxRecords = 100): StreamFeature => ({
  name,
  filters: [],
  handler: name,
  batch: { maxRecords, windowSeconds: 5 },
  maxReceiveCount: 3,
});

const message = (id: string) => ({
  body: JSON.stringify({ eventID: id } satisfies Partial<DynamoDBRecord>),
  attributes: { feature: 'f' },
});

const setup = (options: { maxRecords?: number } = {}) => {
  let time = 0;
  const queue = createInProcessQueue({
    visibilityTimeoutMs: 10_000,
    now: () => time,
  });
  const advance = (ms: number) => {
    time += ms;
  };
  const make = (
    name: string,
    run: (event: { Records: DynamoDBRecord[] }) => Promise<void>,
  ) =>
    createFeatureRunner({
      feature: feature(name, options.maxRecords),
      queue,
      queueName: `q-${name}`,
      failureQueueName: `f-${name}`,
      run,
      log: () => {},
      sleep: async (ms) => advance(ms),
      now: () => time,
    });
  return { queue, advance, make };
};

describe('createFeatureRunner', () => {
  it('runs one handler call for a burst of records and deletes the messages', async () => {
    const { queue, make } = setup();
    const run = vi.fn(async () => {});
    const runner = make('alpha', run);
    await queue.sendBatch(
      'q-alpha',
      Array.from({ length: 25 }, (_, i) => message(String(i))),
    );

    expect(await runner.runOnce()).toBe(true);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0].Records).toHaveLength(25);
    expect(run.mock.calls[0][0].Records[0].eventID).toBe('0');
    expect(await queue.depth('q-alpha')).toEqual({ waiting: 0, inFlight: 0 });
  });

  it('hands the handler a batch in stream order, whatever order it was received in', async () => {
    const { queue, make } = setup();
    const run = vi.fn(async () => {});
    const runner = make('alpha', run);
    const withSequence = (id: string, sequence: string) => ({
      body: JSON.stringify({
        eventID: id,
        dynamodb: { SequenceNumber: sequence },
      }),
      attributes: { feature: 'f' },
    });
    await queue.sendBatch('q-alpha', [
      withSequence('c', '300'),
      withSequence('a', '99'),
      withSequence('b', '1000'),
    ]);

    await runner.runOnce();

    expect(run.mock.calls[0][0].Records.map((r) => r.eventID)).toEqual([
      'a',
      'c',
      'b',
    ]);
  });

  it('closes a batch at maxRecords', async () => {
    const { queue, make } = setup({ maxRecords: 10 });
    const run = vi.fn(async () => {});
    const runner = make('alpha', run);
    await queue.sendBatch(
      'q-alpha',
      Array.from({ length: 12 }, (_, i) => message(String(i))),
    );

    await runner.runOnce();

    expect(run.mock.calls[0][0].Records).toHaveLength(10);
  });

  it('does nothing when the queue is empty', async () => {
    const { make } = setup();
    const run = vi.fn(async () => {});

    expect(await make('alpha', run).runOnce()).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('leaves messages to return after a failure, then moves them to the failure queue after maxReceiveCount receives', async () => {
    const { queue, advance, make } = setup();
    const run = vi.fn(async () => {
      throw new Error('boom');
    });
    const runner = make('alpha', run);
    await queue.sendBatch('q-alpha', [message('1')]);

    await runner.runOnce();
    expect(await queue.depth('q-alpha')).toEqual({ waiting: 0, inFlight: 1 });
    advance(10_000);
    await runner.runOnce();
    advance(10_000);
    expect(queue.peek('f-alpha')).toEqual([]);
    await runner.runOnce();

    expect(run).toHaveBeenCalledTimes(3);
    expect(queue.peek('q-alpha')).toEqual([]);
    expect(queue.peek('f-alpha')).toHaveLength(1);
  });

  it('keeps another feature working while one fails', async () => {
    const { queue, make } = setup();
    const failing = make('alpha', async () => {
      throw new Error('boom');
    });
    const working = vi.fn(async () => {});
    const other = make('beta', working);
    await queue.sendBatch('q-alpha', [message('1')]);
    await queue.sendBatch('q-beta', [message('2')]);

    await failing.runOnce();
    await other.runOnce();

    expect(working).toHaveBeenCalledTimes(1);
    expect(await queue.depth('q-beta')).toEqual({ waiting: 0, inFlight: 0 });
    expect(queue.peek('f-beta')).toEqual([]);
  });

  it('fails its next batches on request without calling the handler', async () => {
    const { queue, advance, make } = setup();
    const run = vi.fn(async () => {});
    const runner = make('alpha', run);
    await queue.sendBatch('q-alpha', [message('1')]);
    runner.failNext(1);

    await runner.runOnce();
    expect(run).not.toHaveBeenCalled();
    expect(runner.failing()).toBe(0);
    advance(10_000);
    await runner.runOnce();

    expect(run).toHaveBeenCalledTimes(1);
    expect(await queue.depth('q-alpha')).toEqual({ waiting: 0, inFlight: 0 });
  });
});
