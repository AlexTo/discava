/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import type { StreamFeature } from '@discava/core-table';
import { STREAM_FEATURES } from '@discava/core-table';
import type { DynamoDBRecord } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { routeRecords } from './route-records.js';

const record = (
  eventID: string,
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
  entity: string,
  extra: Record<string, unknown> = {},
): DynamoDBRecord => {
  const image = {
    __edb_e__: { S: entity },
    courseId: { S: 'c1' },
    ...extra,
  };
  return {
    eventID,
    eventName,
    dynamodb:
      eventName === 'REMOVE' ? { OldImage: image } : { NewImage: image },
  } as DynamoDBRecord;
};

describe('routeRecords', () => {
  it('sends one message per record to the feature it matches', () => {
    const { messages, refused } = routeRecords([
      record('1', 'INSERT', 'itemCompletion'),
      record('2', 'MODIFY', 'course'),
      record('3', 'MODIFY', 'lesson'),
    ]);
    expect(refused).toEqual([]);
    expect(
      messages.get('progress-recalculation')?.map((m) => m.record.eventID),
    ).toEqual(['1', '3']);
    expect(
      messages.get('search-indexing')?.map((m) => m.record.eventID),
    ).toEqual(['2']);
  });

  it('carries the record as JSON with feature and entity attributes', () => {
    const r = record('1', 'MODIFY', 'course');
    const message = routeRecords([r]).messages.get('search-indexing')?.[0];
    expect(JSON.parse(message?.body ?? '')).toEqual(r);
    expect(message?.attributes).toEqual({
      feature: 'search-indexing',
      entity: 'course',
    });
  });

  it('reads the entity of a removed record from its old image', () => {
    const message = routeRecords([
      record('1', 'REMOVE', 'course'),
    ]).messages.get('search-indexing')?.[0];
    expect(message?.attributes.entity).toBe('course');
  });

  it('routes a record matching two features to both, as separate messages', () => {
    const both: StreamFeature[] = [
      ...STREAM_FEATURES,
      { ...(STREAM_FEATURES[1] as StreamFeature), name: 'copy' },
    ];
    const { messages } = routeRecords([record('1', 'MODIFY', 'course')], both);
    expect([...messages.keys()]).toEqual(['search-indexing', 'copy']);
  });

  it('produces nothing for a record no feature wants', () => {
    const { messages, refused } = routeRecords([
      record('1', 'MODIFY', 'progress'),
    ]);
    expect(messages.size).toBe(0);
    expect(refused).toEqual([]);
  });

  it('returns an oversized record as refused and does not send it', () => {
    const big = record('1', 'MODIFY', 'course', {
      title: { S: 'x'.repeat(500) },
    });
    const small = record('2', 'MODIFY', 'course');
    const { messages, refused } = routeRecords(
      [big, small],
      STREAM_FEATURES,
      400,
    );
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({
      record: big,
      features: ['search-indexing'],
    });
    expect(refused[0]?.bytes).toBeGreaterThan(400);
    expect(
      messages.get('search-indexing')?.map((m) => m.record.eventID),
    ).toEqual(['2']);
  });

  it('routes to a third registration without any change to the router', () => {
    const third: StreamFeature = {
      name: 'notification-delivery',
      filters: [
        { eventName: 'INSERT', image: 'NewImage', entities: ['certificate'] },
      ],
      handler: 'notification-delivery',
      batch: { maxRecords: 10, windowSeconds: 1 },
      maxReceiveCount: 3,
    };
    const { messages } = routeRecords(
      [record('1', 'INSERT', 'certificate')],
      [...STREAM_FEATURES, third],
    );
    expect([...messages.keys()]).toEqual(['notification-delivery']);
  });
});
