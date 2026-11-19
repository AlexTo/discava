/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { DynamoDBStreamSchema } from '@aws-lambda-powertools/parser/schemas';
import { STREAM_FEATURES } from '@discava/core-table';
import type { DynamoDBRecord } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { createStreamRouter } from '../router/stream-router.js';
import { createFeatureRunner } from './feature-runner.js';
import { createInProcessQueue } from './in-process-queue.js';

// The local runner builds its router and one feature runner per registered
// feature from STREAM_FEATURES (event-runner.ts). This runs the same pieces
// over the in-process queue to see an order reach earnings recording.
const VISIBILITY_TIMEOUT_MS = 10_000;

describe('the earnings-recording feature locally', () => {
  const feature = STREAM_FEATURES.find((f) => f.name === 'earnings-recording')!;

  const record = (entity: string, eventName = 'INSERT') =>
    ({
      eventID: `e-${entity}`,
      eventName,
      eventSource: 'aws:dynamodb',
      eventVersion: '1.1',
      awsRegion: 'local',
      eventSourceARN: 'arn:aws:dynamodb:local:000000000000:table/t/stream/1',
      dynamodb: {
        Keys: { pk: { S: 'x' }, sk: { S: 'y' } },
        SequenceNumber: '1',
        SizeBytes: 1,
        StreamViewType: 'NEW_AND_OLD_IMAGES',
        NewImage: { __edb_e__: { S: entity }, orderId: { S: 'o1' } },
      },
    }) as unknown as DynamoDBRecord;

  const setup = (run: (event: unknown) => Promise<void>) => {
    let time = 0;
    const queue = createInProcessQueue({
      visibilityTimeoutMs: VISIBILITY_TIMEOUT_MS,
      now: () => time,
    });
    const route = createStreamRouter({
      queue,
      queueFor: (name) => `q-${name}`,
      failureQueue: 'router-failures',
    });
    const runner = createFeatureRunner({
      feature,
      queue,
      queueName: 'q-earnings-recording',
      failureQueueName: 'f-earnings-recording',
      run,
      log: () => {},
      sleep: async (ms) => {
        time += ms;
      },
      now: () => time,
    });
    const advance = (ms: number) => {
      time += ms;
    };
    return { queue, route, runner, advance };
  };

  it('is registered with the contract settings', () => {
    expect(feature).toMatchObject({
      handler: 'earnings-recording',
      batch: { maxRecords: 100, windowSeconds: 5 },
      maxReceiveCount: 5,
      maxConcurrency: 2,
    });
  });

  it('gets an order INSERT through the router and its queue', async () => {
    const seen: unknown[] = [];
    const { queue, route, runner } = setup(async (event) => {
      seen.push(DynamoDBStreamSchema.parse(event));
    });

    await route({ Records: [record('order')] });
    expect(await queue.depth('q-earnings-recording')).toEqual({
      waiting: 1,
      inFlight: 0,
    });
    expect(await runner.runOnce()).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it('routes an earningEntry INSERT to no queue, so recording cannot loop', async () => {
    const { queue, route } = setup(async () => {});

    await route({ Records: [record('earningEntry'), record('earningDay')] });

    expect(await queue.depth('q-earnings-recording')).toEqual({
      waiting: 0,
      inFlight: 0,
    });
  });

  it('moves a batch that keeps failing to the failure queue after 5 receives', async () => {
    const { queue, route, runner, advance } = setup(async () => {
      throw new Error('write failed');
    });

    await route({ Records: [record('order')] });
    for (let receive = 0; receive < feature.maxReceiveCount; receive++) {
      await runner.runOnce();
      advance(VISIBILITY_TIMEOUT_MS);
    }
    await runner.runOnce();

    expect(await queue.depth('q-earnings-recording')).toEqual({
      waiting: 0,
      inFlight: 0,
    });
    expect(await queue.depth('f-earnings-recording')).toMatchObject({
      waiting: 1,
    });
  });
});
