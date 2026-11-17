/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  featuresFor,
  STREAM_FEATURES,
  type StreamFeature,
} from '@discava/core-table';
import type { DynamoDBRecord } from 'aws-lambda';
import {
  MAX_MESSAGE_BYTES,
  messageBytes,
  type QueueMessage,
} from './queue-client.js';

export interface RoutedMessage extends QueueMessage {
  feature: string;
  /** The stream record the message carries, for reporting a failed send. */
  record: DynamoDBRecord;
}

export interface RefusedRecord {
  record: DynamoDBRecord;
  /** The features whose filters matched. */
  features: readonly string[];
  bytes: number;
  reason: string;
}

export interface RoutedRecords {
  /** Messages per feature name, one per record, in arrival order. */
  messages: ReadonlyMap<string, readonly RoutedMessage[]>;
  /** Records too large to send to at least one feature's queue. */
  refused: readonly RefusedRecord[];
}

/** A record's entity, as ElectroDB stores it in `__edb_e__`. */
export const entityOf = (record: DynamoDBRecord): string =>
  record.dynamodb?.NewImage?.__edb_e__?.S ??
  record.dynamodb?.OldImage?.__edb_e__?.S ??
  '';

/**
 * Turns stream records into queue messages: one message per record per
 * matching feature, its body the record as JSON (the shape handlers parse),
 * its attributes `feature` and `entity`. Pure: it filters through
 * `featuresFor` and holds no list of features itself, so a feature added to
 * the registry is routed to without a change here. A record whose message
 * would exceed the queue's limit is returned as refused and sent nowhere.
 */
export const routeRecords = (
  records: readonly DynamoDBRecord[],
  features: readonly StreamFeature[] = STREAM_FEATURES,
  maxBytes: number = MAX_MESSAGE_BYTES,
): RoutedRecords => {
  const messages = new Map<string, RoutedMessage[]>();
  const refused: RefusedRecord[] = [];

  for (const record of records) {
    const matched = featuresFor(record, features);
    if (matched.length === 0) continue;

    const body = JSON.stringify(record);
    const entity = entityOf(record);
    const candidates = matched.map((feature) => ({
      feature,
      record,
      body,
      attributes: { feature, entity },
    }));
    const bytes = Math.max(...candidates.map(messageBytes));
    if (bytes > maxBytes) {
      refused.push({
        record,
        features: matched,
        bytes,
        reason: `message of ${bytes} bytes exceeds the ${maxBytes} byte limit`,
      });
      continue;
    }
    for (const message of candidates) {
      const list = messages.get(message.feature) ?? [];
      list.push(message);
      messages.set(message.feature, list);
    }
  }
  return { messages, refused };
};
