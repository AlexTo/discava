/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { STREAM_FEATURES, type StreamFeature } from '@discava/core-table';
import type { DynamoDBRecord } from 'aws-lambda';
import {
  MAX_MESSAGE_BYTES,
  type QueueClient,
  type QueueMessage,
  SEND_BATCH_SIZE,
} from './queue-client.js';
import {
  entityOf,
  type RefusedRecord,
  type RoutedMessage,
  routeRecords,
} from './route-records.js';

export interface StreamRouterOptions {
  queue: QueueClient;
  /** Where each feature's messages go, by registration name. */
  queueFor: (feature: string) => string;
  /** Where records the router can't send are described. */
  failureQueue: string;
  features?: readonly StreamFeature[];
  maxBytes?: number;
}

export interface StreamRouterResult {
  batchItemFailures: { itemIdentifier: string }[];
}

// A DynamoDB stream mapping reports a failed record by its sequence number.
const identifierOf = (record: DynamoDBRecord): string =>
  record.dynamodb?.SequenceNumber ?? record.eventID ?? '';

/**
 * Builds the router: the function a DynamoDB stream mapping invokes with a
 * batch of the core table's records. It sends each record to the queue of
 * every feature that wants it (`routeRecords`, so the registry alone decides)
 * and does no filtering of its own.
 *
 * Only a record whose send failed for a transient reason is returned in
 * `batchItemFailures`, so the mapping retries that record and not the batch.
 * A record that can never be sent (too large, or refused by the queue) is
 * described to the failure queue (its `eventID`, keys, entity, features, size
 * and reason; not the record) and counted as handled, so it doesn't block its
 * shard. If that write fails too, the record is reported like any transient
 * error rather than dropped without a trace.
 */
export const createStreamRouter =
  ({
    queue,
    queueFor,
    failureQueue,
    features = STREAM_FEATURES,
    maxBytes = MAX_MESSAGE_BYTES,
  }: StreamRouterOptions) =>
  async (event: { Records: DynamoDBRecord[] }): Promise<StreamRouterResult> => {
    const { messages, refused } = routeRecords(
      event.Records,
      features,
      maxBytes,
    );
    const transient = new Set<DynamoDBRecord>();
    const unroutable: RefusedRecord[] = [...refused];

    for (const [feature, routed] of messages) {
      for (let start = 0; start < routed.length; start += SEND_BATCH_SIZE) {
        const chunk: readonly RoutedMessage[] = routed.slice(
          start,
          start + SEND_BATCH_SIZE,
        );
        const failures = await queue.sendBatch(queueFor(feature), chunk);
        for (const failure of failures) {
          const { record } = chunk[failure.index];
          if (failure.transient) {
            transient.add(record);
          } else {
            unroutable.push({
              record,
              features: [feature],
              bytes: Buffer.byteLength(chunk[failure.index].body),
              reason: failure.reason,
            });
          }
        }
      }
    }

    if (unroutable.length > 0) {
      const described: QueueMessage[] = unroutable.map(
        ({ record, features: matched, bytes, reason }) => ({
          body: JSON.stringify({
            eventID: record.eventID,
            keys: record.dynamodb?.Keys,
            entity: entityOf(record),
            features: matched,
            bytes,
            reason,
          }),
          attributes: { entity: entityOf(record) },
        }),
      );
      for (let start = 0; start < described.length; start += SEND_BATCH_SIZE) {
        const failures = await queue.sendBatch(
          failureQueue,
          described.slice(start, start + SEND_BATCH_SIZE),
        );
        for (const { index } of failures) {
          transient.add(unroutable[start + index].record);
        }
      }
    }

    return {
      batchItemFailures: [...transient].map((record) => ({
        itemIdentifier: identifierOf(record),
      })),
    };
  };
