/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { DynamoDBStreamSchema } from '@aws-lambda-powertools/parser/schemas';
import type { _Record as StreamRecord } from '@aws-sdk/client-dynamodb-streams';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBatcher,
  pollStream,
  toLambdaRecord,
} from './dynamodb-stream.js';

const STREAM_ARN =
  'arn:aws:dynamodb:ddblocal:000000000000:table/discava-core-table/stream/2026-10-22T00:00:00.000';

// A record as DynamoDB local's GetRecords returns it.
const completion = (n = 1): StreamRecord => ({
  eventID: `event-${n}`,
  eventName: 'INSERT',
  eventVersion: '1.1',
  eventSource: 'aws:dynamodb',
  awsRegion: 'ddblocal',
  dynamodb: {
    ApproximateCreationDateTime: new Date('2026-10-22T01:02:03.000Z'),
    Keys: { pk: { S: 'pk-1' }, sk: { S: `sk-${n}` } },
    NewImage: {
      __edb_e__: { S: 'itemCompletion' },
      courseId: { S: 'course-1' },
      userId: { S: 'student-1' },
    },
    SequenceNumber: `${n}00`,
    SizeBytes: 120,
    StreamViewType: 'NEW_AND_OLD_IMAGES',
  },
});

describe('toLambdaRecord', () => {
  it('gives a record the shape the deployed handler’s parser accepts', () => {
    const parsed = DynamoDBStreamSchema.parse({
      Records: [toLambdaRecord(completion(), STREAM_ARN)],
    });

    expect(parsed.Records[0]).toMatchObject({
      eventName: 'INSERT',
      eventSourceARN: STREAM_ARN,
      dynamodb: {
        ApproximateCreationDateTime: 1792630923,
        // Unmarshalled by the parser, as for a deployed invocation.
        NewImage: { __edb_e__: 'itemCompletion', userId: 'student-1' },
      },
    });
  });
});

describe('createBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('delivers a batch once the window after its first record ends', async () => {
    const deliver = vi.fn(async () => {});
    const batcher = createBatcher({ maxRecords: 100, windowMs: 5000, deliver });

    batcher.add([1, 2]);
    await vi.advanceTimersByTimeAsync(4000);
    batcher.add([3]);
    expect(deliver).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);

    expect(deliver).toHaveBeenCalledExactlyOnceWith([1, 2, 3]);
  });

  it('delivers a full batch straight away, in order', async () => {
    const deliver = vi.fn(async () => {});
    const batcher = createBatcher({ maxRecords: 2, windowMs: 5000, deliver });

    batcher.add([1, 2, 3]);
    await vi.advanceTimersByTimeAsync(0);
    expect(deliver.mock.calls).toEqual([[[1, 2]]]);
    await vi.advanceTimersByTimeAsync(5000);

    expect(deliver.mock.calls).toEqual([[[1, 2]], [[3]]]);
  });

  it('delivers nothing for records the filters dropped', async () => {
    const deliver = vi.fn(async () => {});
    const batcher = createBatcher({ maxRecords: 100, windowMs: 5000, deliver });

    batcher.add([]);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(deliver).not.toHaveBeenCalled();
  });
});

describe('pollStream', () => {
  // A stream with an open shard, a closed one, and records waiting on the
  // open shard.
  const fakeStreams = (shards: { ShardId: string; closed?: boolean }[]) => {
    const iteratorTypes: Record<string, string> = {};
    const send = vi.fn(
      async (command: {
        constructor: { name: string };
        input: Record<string, string>;
      }) => {
        switch (command.constructor.name) {
          case 'DescribeStreamCommand':
            return {
              StreamDescription: {
                Shards: shards.map(({ ShardId, closed }) => ({
                  ShardId,
                  SequenceNumberRange: closed
                    ? { StartingSequenceNumber: '1', EndingSequenceNumber: '2' }
                    : { StartingSequenceNumber: '1' },
                })),
              },
            };
          case 'GetShardIteratorCommand':
            iteratorTypes[command.input.ShardId] =
              command.input.ShardIteratorType;
            return { ShardIterator: `${command.input.ShardId}-iterator` };
          case 'GetRecordsCommand':
            return {
              Records: [completion()],
              NextShardIterator: command.input.ShardIterator,
            };
          default:
            throw new Error(command.constructor.name);
        }
      },
    );
    return { streams: { send } as never, iteratorTypes, send };
  };

  it('reads open shards from now on, and hands records on as Lambda would', async () => {
    const { streams, iteratorTypes } = fakeStreams([
      { ShardId: 'shard-old', closed: true },
      { ShardId: 'shard-open' },
    ]);
    const abort = new AbortController();
    const received: unknown[] = [];

    await pollStream({
      streams,
      describeTable: async () =>
        ({ Table: { TableName: 't', LatestStreamArn: STREAM_ARN } }) as never,
      onRecords: (records) => {
        received.push(...records);
        abort.abort();
      },
      pollIntervalMs: 0,
      signal: abort.signal,
    });

    expect(iteratorTypes).toEqual({ 'shard-open': 'LATEST' });
    expect(received).toEqual([toLambdaRecord(completion(), STREAM_ARN)]);
  });

  it('says what to do when the table has no stream', async () => {
    await expect(
      pollStream({
        streams: fakeStreams([]).streams,
        describeTable: async () => ({ Table: { TableName: 't' } }) as never,
        onRecords: () => {},
      }),
    ).rejects.toThrow('t has no stream; re-run its dev target to add one');
  });
});
