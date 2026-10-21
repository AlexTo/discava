/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DescribeTableCommandOutput } from '@aws-sdk/client-dynamodb';
import {
  DescribeStreamCommand,
  type DynamoDBStreamsClient,
  GetRecordsCommand,
  GetShardIteratorCommand,
  type _Record as StreamRecord,
} from '@aws-sdk/client-dynamodb-streams';
import type { DynamoDBRecord } from 'aws-lambda';

// Local dev's stand-in for a Lambda event source mapping on the core table's
// stream (#137): reads DynamoDB local's stream, and hands records on in the
// shape Lambda delivers them.

/**
 * A stream record as GetRecords returns it, in the shape a Lambda receives it
 * from an event source mapping: with the stream's ARN, and the creation time
 * in epoch seconds rather than a Date.
 */
export const toLambdaRecord = (
  record: StreamRecord,
  streamArn: string,
): DynamoDBRecord =>
  ({
    eventID: record.eventID,
    eventName: record.eventName,
    eventVersion: record.eventVersion ?? '1.1',
    eventSource: record.eventSource ?? 'aws:dynamodb',
    awsRegion: record.awsRegion ?? 'local',
    eventSourceARN: streamArn,
    dynamodb: {
      ...record.dynamodb,
      ApproximateCreationDateTime: record.dynamodb?.ApproximateCreationDateTime
        ? Math.floor(
            record.dynamodb.ApproximateCreationDateTime.getTime() / 1000,
          )
        : undefined,
    },
  }) as DynamoDBRecord;

/**
 * Gathers records into batches, like an event source mapping: a batch goes
 * when it reaches `maxRecords`, or `windowMs` after its first record.
 * Batches are delivered one at a time, in order.
 */
export const createBatcher = <T>({
  maxRecords,
  windowMs,
  deliver,
}: {
  maxRecords: number;
  windowMs: number;
  deliver: (batch: T[]) => Promise<void>;
}) => {
  let buffer: T[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delivering = Promise.resolve();

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (buffer.length === 0) return delivering;
    const batch = buffer;
    buffer = [];
    delivering = delivering.then(() => deliver(batch));
    return delivering;
  };

  return {
    add(records: T[]) {
      for (const record of records) {
        buffer.push(record);
        if (buffer.length >= maxRecords) {
          void flush();
        }
      }
      if (buffer.length > 0 && !timer) {
        timer = setTimeout(() => void flush(), windowMs);
      }
    },
    /** Delivers whatever is waiting, and resolves once every batch is. */
    flush,
  };
};

/**
 * Reads a table's stream from now on, calling `onRecords` with each shard's
 * new records, until `signal` aborts. Shards that appear later (DynamoDB
 * rotates them) are read from their start, so nothing written after this
 * starts is missed; anything written before it is, like an event source
 * mapping created at LATEST.
 */
export const pollStream = async ({
  streams,
  describeTable,
  onRecords,
  pollIntervalMs = 1000,
  refreshShardsMs = 10_000,
  signal,
}: {
  streams: DynamoDBStreamsClient;
  describeTable: () => Promise<DescribeTableCommandOutput>;
  onRecords: (records: DynamoDBRecord[]) => void;
  pollIntervalMs?: number;
  refreshShardsMs?: number;
  signal?: AbortSignal;
}): Promise<void> => {
  const { Table } = await describeTable();
  const streamArn = Table?.LatestStreamArn;
  if (!streamArn) {
    throw new Error(
      `${Table?.TableName ?? 'The table'} has no stream; re-run its dev target to add one`,
    );
  }

  // Each shard's next iterator; a shard is dropped once it's closed and read.
  const iterators = new Map<string, string>();
  const seen = new Set<string>();
  let firstRefresh = true;

  const refreshShards = async () => {
    let exclusiveStartShardId: string | undefined;
    do {
      const { StreamDescription } = await streams.send(
        new DescribeStreamCommand({
          StreamArn: streamArn,
          ExclusiveStartShardId: exclusiveStartShardId,
        }),
      );
      for (const shard of StreamDescription?.Shards ?? []) {
        const shardId = shard.ShardId;
        if (!shardId || seen.has(shardId)) continue;
        seen.add(shardId);
        const open = !shard.SequenceNumberRange?.EndingSequenceNumber;
        // At start, only open shards matter, from now; later, a new shard is
        // read from its start.
        if (firstRefresh && !open) continue;
        const { ShardIterator } = await streams.send(
          new GetShardIteratorCommand({
            StreamArn: streamArn,
            ShardId: shardId,
            ShardIteratorType: firstRefresh ? 'LATEST' : 'TRIM_HORIZON',
          }),
        );
        if (ShardIterator) iterators.set(shardId, ShardIterator);
      }
      exclusiveStartShardId = StreamDescription?.LastEvaluatedShardId;
    } while (exclusiveStartShardId);
    firstRefresh = false;
  };

  await refreshShards();
  let lastRefresh = Date.now();
  while (!signal?.aborted) {
    for (const [shardId, iterator] of iterators) {
      const { Records, NextShardIterator } = await streams.send(
        new GetRecordsCommand({ ShardIterator: iterator }),
      );
      if (Records?.length) {
        onRecords(Records.map((record) => toLambdaRecord(record, streamArn)));
      }
      if (NextShardIterator) {
        iterators.set(shardId, NextShardIterator);
      } else {
        iterators.delete(shardId);
      }
    }
    if (Date.now() - lastRefresh >= refreshShardsMs) {
      await refreshShards();
      lastRefresh = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
};
