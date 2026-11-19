/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { DynamoDBStreamSchema } from '@aws-lambda-powertools/parser/schemas';
import {
  NOTIFICATION_STREAM_FILTERS,
  type StreamFeature,
} from '@discava/core-table';
import type { DynamoDBRecord } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { createStreamRouter } from '../router/stream-router.js';
import { createFeatureRunner } from './feature-runner.js';
import { createInProcessQueue } from './in-process-queue.js';

const delivery = vi.hoisted(() =>
  vi.fn(async () => ({ handled: 1, ignored: 0 })),
);
vi.mock('../notifications/notification-delivery.js', async (importActual) => ({
  ...(await importActual<
    typeof import('../notifications/notification-delivery.js')
  >()),
  notificationDelivery: delivery,
}));

import { notificationDelivery } from '../notifications/notification-delivery.js';

// The local runner builds its router and feature runners from STREAM_FEATURES
// (event-runner.ts), and the notification-delivery registration is added with
// the deployed wiring (T020). This runs the same pieces over the in-process
// queue with an equivalent registration, to see a notification INSERT reach
// the delivery handler through its queue.
describe('the notification-delivery feature locally', () => {
  const feature: StreamFeature = {
    name: 'notification-delivery',
    filters: NOTIFICATION_STREAM_FILTERS,
    handler: 'notification-delivery',
    batch: { maxRecords: 100, windowSeconds: 5 },
    maxReceiveCount: 5,
  };

  const record = (sequence: string, entity: string, eventName = 'INSERT') =>
    ({
      eventID: `e${sequence}`,
      eventName,
      eventSource: 'aws:dynamodb',
      eventVersion: '1.1',
      awsRegion: 'local',
      eventSourceARN: 'arn:aws:dynamodb:local:000000000000:table/t/stream/1',
      dynamodb: {
        Keys: { pk: { S: 'x' }, sk: { S: sequence } },
        SequenceNumber: sequence,
        SizeBytes: 1,
        StreamViewType: 'NEW_AND_OLD_IMAGES',
        NewImage: {
          __edb_e__: { S: entity },
          userId: { S: 'u1' },
          occurredAt: { S: '2026-11-17T00:00:00.000Z' },
          id: { S: 'aaaaaaaaaaaaaaaa' },
        },
      },
    }) as unknown as DynamoDBRecord;

  it('gets notification and broadcast INSERTs through the router and its queue, and nothing else', async () => {
    let time = 0;
    const queue = createInProcessQueue({ now: () => time });
    const route = createStreamRouter({
      queue,
      queueFor: (name) => `q-${name}`,
      failureQueue: 'router-failures',
      features: [feature],
    });
    const seen: string[] = [];
    const runner = createFeatureRunner({
      feature,
      queue,
      queueName: 'q-notification-delivery',
      failureQueueName: 'f-notification-delivery',
      run: async (event) => {
        const parsed = DynamoDBStreamSchema.parse(event);
        await notificationDelivery({} as never, parsed, {} as never);
        seen.push(
          ...parsed.Records.map((r) => String(r.dynamodb.NewImage?.__edb_e__)),
        );
      },
      log: () => {},
      sleep: async (ms) => {
        time += ms;
      },
      now: () => time,
    });

    await route({
      Records: [
        record('1', 'notification'),
        record('2', 'notificationBroadcast'),
        record('3', 'enrolment'),
        record('4', 'notification', 'MODIFY'),
      ],
    });
    expect(await queue.depth('q-notification-delivery')).toEqual({
      waiting: 2,
      inFlight: 0,
    });

    expect(await runner.runOnce()).toBe(true);
    expect(seen.sort()).toEqual(['notification', 'notificationBroadcast']);
    expect(delivery).toHaveBeenCalledOnce();
    expect(await queue.depth('q-notification-delivery')).toEqual({
      waiting: 0,
      inFlight: 0,
    });
  });
});
