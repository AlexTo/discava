/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { DynamoDBStreamSchema } from '@aws-lambda-powertools/parser/schemas';
import type { DynamoDBRecord } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@aws-lambda-powertools/parameters/appconfig', () => ({
  getAppConfig: vi.fn(),
}));
vi.mock('@discava/search', () => ({
  getOpenSearchClient: vi.fn(),
  resolveIndexName: (name: string) => name,
}));

import { searchIndexing } from '../search/index-content.js';
import { routeRecords } from './route-records.js';
import { sqsStreamRecords } from './sqs-stream-records.js';

const streamRecord = (id: string, entity: string): DynamoDBRecord =>
  ({
    eventID: id,
    eventName: 'MODIFY',
    eventVersion: '1.1',
    eventSource: 'aws:dynamodb',
    awsRegion: 'ap-southeast-2',
    eventSourceARN: 'arn:aws:dynamodb:ap-southeast-2:1:table/t/stream/s',
    dynamodb: {
      Keys: { pk: { S: 'a' }, sk: { S: 'b' } },
      NewImage: { __edb_e__: { S: entity }, courseId: { S: 'c1' } },
      SequenceNumber: '1',
      SizeBytes: 10,
      StreamViewType: 'NEW_AND_OLD_IMAGES',
      ApproximateCreationDateTime: 1,
    },
  }) as DynamoDBRecord;

const sqsEvent = (records: DynamoDBRecord[]) => ({
  Records: records.map((r) => ({ body: JSON.stringify(r) })),
});

describe('sqsStreamRecords', () => {
  it('keeps the batch order', () => {
    const records = [streamRecord('3', 'lesson'), streamRecord('1', 'lesson')];
    expect(
      sqsStreamRecords(sqsEvent(records) as never).Records.map(
        (r) => r.eventID,
      ),
    ).toEqual(['3', '1']);
  });

  it('round-trips what the router sends, in the shape the handlers parse', () => {
    const records = [streamRecord('1', 'course'), streamRecord('2', 'lesson')];
    const routed = routeRecords(records).messages;
    const body = [...routed.values()].flat().map((m) => ({ body: m.body }));
    const parsed = DynamoDBStreamSchema.parse(
      sqsStreamRecords({ Records: body } as never),
    );
    expect(parsed.Records.map((r) => r.eventID)).toEqual(['1', '2']);
  });

  it('feeds the search handler a batch it can parse', async () => {
    const parsed = DynamoDBStreamSchema.parse(
      sqsStreamRecords(sqsEvent([streamRecord('1', 'lesson')]) as never),
    );
    // A lesson record is not a course: nothing is indexed, so no client is needed.
    const { getOpenSearchClient } = await import('@discava/search');
    vi.mocked(getOpenSearchClient).mockResolvedValue({} as never);
    await expect(searchIndexing(parsed)).resolves.toBeUndefined();
  });
});
