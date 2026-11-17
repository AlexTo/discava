/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { DynamoDBStreamSchema } from '@aws-lambda-powertools/parser/schemas';
import { STREAM_FEATURES } from '@discava/core-table';
import type { DynamoDBRecord } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { analyticsUpdate } from '../analytics/analytics-update.js';
import { createStreamRouter } from '../router/stream-router.js';
import { createFeatureRunner } from './feature-runner.js';
import { createInProcessQueue } from './in-process-queue.js';

// The local runner builds its router and one feature runner per registered
// feature from STREAM_FEATURES (event-runner.ts), so a registered feature
// needs nothing more there. This runs the same pieces over the in-process
// queue to see an enrolment reach the analytics handler through its queue.
describe('the analytics-update feature locally', () => {
  const feature = STREAM_FEATURES.find((f) => f.name === 'analytics-update')!;

  it('is registered with no batcher of its own, run from its own queue', () => {
    expect(feature).toMatchObject({
      handler: 'analytics-update',
      batch: { maxRecords: 100, windowSeconds: 5 },
      maxReceiveCount: 5,
    });
  });

  it('gets an enrolment INSERT through the router and its queue', async () => {
    let time = 0;
    const queue = createInProcessQueue({ now: () => time });
    const route = createStreamRouter({
      queue,
      queueFor: (name) => `q-${name}`,
      failureQueue: 'router-failures',
    });
    const changes: unknown[] = [];
    const runner = createFeatureRunner({
      feature,
      queue,
      queueName: 'q-analytics-update',
      failureQueueName: 'f-analytics-update',
      run: async (event) => {
        await analyticsUpdate(DynamoDBStreamSchema.parse(event), async (c) => {
          changes.push(c);
          return 'applied';
        });
      },
      log: () => {},
      // The batch window passes without waiting.
      sleep: async (ms) => {
        time += ms;
      },
      now: () => time,
    });

    const record = {
      eventID: 'e1',
      eventName: 'INSERT',
      eventSource: 'aws:dynamodb',
      eventVersion: '1.1',
      awsRegion: 'local',
      eventSourceARN: 'arn:aws:dynamodb:local:000000000000:table/t/stream/1',
      dynamodb: {
        Keys: { pk: { S: 'x' }, sk: { S: 'y' } },
        SequenceNumber: '1',
        SizeBytes: 1,
        StreamViewType: 'NEW_AND_OLD_IMAGES',
        NewImage: {
          __edb_e__: { S: 'enrolment' },
          courseId: { S: 'c1' },
          userId: { S: 'u1' },
          status: { S: 'active' },
          createdAt: { S: '2026-11-16T10:00:00.000Z' },
        },
      },
    } as unknown as DynamoDBRecord;

    expect(await route({ Records: [record] })).toEqual({
      batchItemFailures: [],
    });
    expect(await queue.depth('q-analytics-update')).toEqual({
      waiting: 1,
      inFlight: 0,
    });
    expect(await queue.depth('q-progress-recalculation')).toEqual({
      waiting: 0,
      inFlight: 0,
    });

    expect(await runner.runOnce()).toBe(true);
    expect(changes).toEqual([
      expect.objectContaining({ eventId: 'e1', courseId: 'c1' }),
    ]);
    expect(await queue.depth('q-analytics-update')).toEqual({
      waiting: 0,
      inFlight: 0,
    });
  });
});
