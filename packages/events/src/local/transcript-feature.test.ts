/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { STREAM_FEATURES } from '@discava/core-table';
import type { DynamoDBRecord } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';

const { searchClient, readCaptionFileMock } = vi.hoisted(() => ({
  searchClient: {
    search: vi.fn(),
    bulk: vi.fn(),
  },
  readCaptionFileMock: vi.fn(),
}));

vi.mock('@discava/search', async (importActual) => {
  const actual = await importActual<typeof import('@discava/search')>();
  return { ...actual, getOpenSearchClient: async () => searchClient };
});

const manifest =
  'courses/c1/modules/m1/lessons/l1/content-items/i1/n1/master.m3u8';
const itemRecord = {
  courseId: 'c1',
  moduleId: 'm1',
  lessonId: 'l1',
  contentItemId: 'i1',
  type: 'video',
  status: 'ready',
  s3Key: manifest,
  visibility: 'visible',
  captionTracksRev: 1,
  captionTracks: [
    {
      trackId: 't1',
      nonce: 'n1',
      language: 'en',
      label: 'English',
      source: 'auto',
      key: 'captions/t1.vtt',
      isDefault: true,
    },
  ],
};

vi.mock('@discava/core-table', async (importActual) => {
  const actual = await importActual<typeof import('@discava/core-table')>();
  const get = (data: unknown) => () => ({ go: async () => ({ data }) });
  return {
    ...actual,
    createCoreTableService: async () => ({
      entities: {
        contentItem: { get: get(itemRecord) },
        lesson: { get: get({ visibility: 'visible' }) },
        module: { get: get({ visibility: 'visible' }) },
      },
    }),
  };
});

vi.mock('../search/transcript-sync.js', async (importActual) => {
  const actual =
    await importActual<typeof import('../search/transcript-sync.js')>();
  return { ...actual, readCaptionFileFromS3: readCaptionFileMock };
});

const { createStreamRouter } = await import('../router/stream-router.js');
const { HANDLERS } = await import('../router/handlers.js');
const { createFeatureRunner } = await import('./feature-runner.js');
const { createInProcessQueue } = await import('./in-process-queue.js');

const VISIBILITY_TIMEOUT_MS = 10_000;

describe('the transcript-indexing feature locally', () => {
  const feature = STREAM_FEATURES.find(
    (f) => f.name === 'transcript-indexing',
  )!;

  const record = (entity: string, eventName: string, image = 'NewImage') =>
    ({
      eventID: `e-${entity}-${eventName}`,
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
        [image]: {
          __edb_e__: { S: entity },
          courseId: { S: 'c1' },
          moduleId: { S: 'm1' },
          lessonId: { S: 'l1' },
          contentItemId: { S: 'i1' },
          type: { S: 'video' },
          captionTracksRev: { N: '1' },
          captionTracks: { L: [] },
        },
      },
    }) as unknown as DynamoDBRecord;

  const setup = () => {
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
      queueName: 'q-transcript-indexing',
      failureQueueName: 'f-transcript-indexing',
      run: async (event) => {
        await HANDLERS['transcript-indexing'](
          event as never,
          {
            functionName: 'transcript-indexing',
            awsRequestId: 'local',
            getRemainingTimeInMillis: () => 60_000,
          } as never,
        );
      },
      log: () => {},
      sleep: async (ms) => {
        time += ms;
      },
      now: () => time,
    });
    return { queue, route, runner };
  };

  it('is registered with the contract settings', () => {
    expect(feature).toMatchObject({
      handler: 'transcript-indexing',
      batch: { maxRecords: 100, windowSeconds: 5 },
      maxReceiveCount: 5,
      maxConcurrency: 2,
    });
  });

  it('runs a contentItem INSERT through the router, its queue and the handler to the index', async () => {
    searchClient.search.mockResolvedValue({ body: { hits: { hits: [] } } });
    searchClient.bulk.mockResolvedValue({
      body: { errors: false, items: [] },
    });
    readCaptionFileMock.mockResolvedValue(
      'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nHello there\n',
    );
    const { queue, route, runner } = setup();

    await route({ Records: [record('contentItem', 'INSERT')] });
    expect(await queue.depth('q-transcript-indexing')).toEqual({
      waiting: 1,
      inFlight: 0,
    });
    expect(await runner.runOnce()).toBe(true);

    expect(searchClient.bulk).toHaveBeenCalledTimes(1);
    expect(searchClient.bulk.mock.calls[0][0].body[0]).toEqual({
      index: { _index: 'transcripts', _id: 'i1.t1.00000' },
    });
  });

  it('routes a lesson MODIFY to the transcript queue, and a course MODIFY to none', async () => {
    const { queue, route } = setup();

    await route({ Records: [record('course', 'MODIFY')] });
    expect(await queue.depth('q-transcript-indexing')).toEqual({
      waiting: 0,
      inFlight: 0,
    });

    await route({ Records: [record('lesson', 'MODIFY')] });
    expect(await queue.depth('q-transcript-indexing')).toEqual({
      waiting: 1,
      inFlight: 0,
    });
  });
});
