/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import type { StreamFeature } from '@discava/core-table';
import type { DynamoDBRecord } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { createInProcessQueue } from '../local/in-process-queue.js';
import type { QueueClient } from './queue-client.js';
import { createStreamRouter } from './stream-router.js';

const feature = (name: string, entity: string): StreamFeature => ({
  name,
  filters: [{ eventName: 'INSERT', image: 'NewImage', entities: [entity] }],
  handler: name,
  batch: { maxRecords: 100, windowSeconds: 5 },
  maxReceiveCount: 5,
});
const FEATURES = [feature('alpha', 'course'), feature('beta', 'progress')];

const record = (id: string, entity: string, padding = ''): DynamoDBRecord => ({
  eventID: id,
  eventName: 'INSERT',
  dynamodb: {
    Keys: { pk: { S: id } },
    NewImage: { __edb_e__: { S: entity }, padding: { S: padding } },
    SequenceNumber: `seq-${id}`,
  },
});

const setup = (
  wrap: (queue: QueueClient) => QueueClient = (queue) => queue,
  maxBytes?: number,
) => {
  const queue = createInProcessQueue();
  const router = createStreamRouter({
    queue: wrap(queue),
    features: FEATURES,
    queueFor: (name) => `q-${name}`,
    failureQueue: 'router-failures',
    maxBytes,
  });
  return { queue, router };
};

const bodies = (queue: ReturnType<typeof createInProcessQueue>, name: string) =>
  queue
    .peek(name)
    .map(({ body }) => (JSON.parse(body) as DynamoDBRecord).eventID);

describe('createStreamRouter', () => {
  it('sends each record to the queue of the feature that matches it', async () => {
    const { queue, router } = setup();

    const result = await router({
      Records: [
        record('1', 'course'),
        record('2', 'progress'),
        record('3', 'other'),
      ],
    });

    expect(result).toEqual({ batchItemFailures: [] });
    expect(bodies(queue, 'q-alpha')).toEqual(['1']);
    expect(bodies(queue, 'q-beta')).toEqual(['2']);
    expect(queue.peek('router-failures')).toEqual([]);
  });

  it('reports only the records whose send failed transiently', async () => {
    const { queue, router } = setup((inner) => ({
      ...inner,
      sendBatch: async (name, messages) =>
        name === 'q-beta'
          ? [{ index: 0, transient: true, reason: 'throttled' }]
          : inner.sendBatch(name, messages),
    }));

    const result = await router({
      Records: [record('1', 'course'), record('2', 'progress')],
    });

    expect(result).toEqual({
      batchItemFailures: [{ itemIdentifier: 'seq-2' }],
    });
    expect(bodies(queue, 'q-alpha')).toEqual(['1']);
  });

  it('writes an oversized record to the failure queue, not the record itself, and holds nothing else up', async () => {
    const { queue, router } = setup(undefined, 600);

    const result = await router({
      Records: [record('1', 'course'), record('2', 'course', 'x'.repeat(2000))],
    });

    expect(result).toEqual({ batchItemFailures: [] });
    expect(bodies(queue, 'q-alpha')).toEqual(['1']);
    const [failure] = queue.peek('router-failures');
    expect(JSON.parse(failure.body)).toMatchObject({
      eventID: '2',
      keys: { pk: { S: '2' } },
      entity: 'course',
      features: ['alpha'],
      bytes: expect.any(Number),
      reason: expect.stringContaining('exceeds'),
    });
    expect(failure.body).not.toContain('xxxx');
  });

  it('reports an oversized record whose failure-queue write fails', async () => {
    const { router } = setup(
      (inner) => ({
        ...inner,
        sendBatch: async (name, messages) =>
          name === 'router-failures'
            ? [{ index: 0, transient: true, reason: 'throttled' }]
            : inner.sendBatch(name, messages),
      }),
      600,
    );

    const result = await router({
      Records: [record('1', 'course'), record('2', 'course', 'x'.repeat(2000))],
    });

    expect(result).toEqual({
      batchItemFailures: [{ itemIdentifier: 'seq-2' }],
    });
  });

  it('treats a send that can never succeed as unroutable', async () => {
    const { queue, router } = setup((inner) => ({
      ...inner,
      sendBatch: async (name, messages) =>
        name === 'q-alpha'
          ? [{ index: 0, transient: false, reason: 'no such queue' }]
          : inner.sendBatch(name, messages),
    }));

    const result = await router({ Records: [record('1', 'course')] });

    expect(result).toEqual({ batchItemFailures: [] });
    expect(JSON.parse(queue.peek('router-failures')[0].body)).toMatchObject({
      eventID: '1',
      reason: 'no such queue',
    });
  });

  it('sends ten messages per call', async () => {
    const calls: number[] = [];
    const { router } = setup((inner) => ({
      ...inner,
      sendBatch: async (name, messages) => {
        calls.push(messages.length);
        return inner.sendBatch(name, messages);
      },
    }));

    await router({
      Records: Array.from({ length: 25 }, (_, i) =>
        record(String(i), 'course'),
      ),
    });

    expect(calls).toEqual([10, 10, 5]);
  });
});
