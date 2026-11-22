/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { DynamoDBStreamSchema } from '@aws-lambda-powertools/parser/schemas';
import { STREAM_FEATURES } from '@discava/core-table';
import type { DynamoDBRecord } from 'aws-lambda';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createStreamRouter } from '../router/stream-router.js';
import { createFeatureRunner } from './feature-runner.js';
import { createInProcessQueue } from './in-process-queue.js';

const h = vi.hoisted(() => {
  process.env.LOCAL_DEV = 'true';
  return {
    item: {
      status: 'ready',
      type: 'video',
      s3Key: 'courses/c1/modules/m1/lessons/l1/content-items/i1/n1/master.m3u8',
      captionTracksRev: 1,
      captionTracks: [
        {
          trackId: 'src',
          nonce: 'n1',
          language: 'en-US',
          label: 'English',
          source: 'auto',
          key: 'src.vtt',
          isDefault: true,
        },
      ],
    } as Record<string, unknown>,
    puts: new Map<string, string>(),
  };
});

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: {
      course: {
        get: () => ({
          go: async () => ({
            data: {
              courseId: 'c1',
              language: 'en',
              captionLanguages: ['es-ES'],
            },
          }),
        }),
      },
    },
  })),
  getCaptionRecord: vi.fn(async () => h.item),
  writeTranslatedCaptionTracks: vi.fn(
    async (_e: unknown, _k: unknown, { tracks }: { tracks: unknown[] }) => {
      h.item.captionTracks = tracks;
    },
  ),
  writeCaptionTranslationOutcome: vi.fn(),
}));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function () {
    return {
      send: async (c: { type: string; Key: string; Body?: string }) => {
        if (c.type === 'get') {
          return {
            Body: {
              transformToString: async () =>
                'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n',
            },
          };
        }
        if (c.type === 'put') {
          h.puts.set(c.Key, c.Body ?? '');
        }
        return {};
      },
    };
  }),
  GetObjectCommand: vi.fn(function (i) {
    return { type: 'get', ...i };
  }),
  PutObjectCommand: vi.fn(function (i) {
    return { type: 'put', ...i };
  }),
  DeleteObjectCommand: vi.fn(function (i) {
    return { type: 'delete', ...i };
  }),
}));
vi.mock('@discava/common-server-utils/lesson-media-bucket', () => ({
  resolveLessonMediaBucketName: vi.fn(async () => 'bucket'),
}));

let captionTranslation: typeof import('../media/caption-translation.js').captionTranslation;
beforeAll(async () => {
  ({ captionTranslation } = await import('../media/caption-translation.js'));
});

// The local runner builds its router and feature runners from STREAM_FEATURES;
// this runs the same pieces to see a video change reach the handler.
describe('the caption-translation feature locally', () => {
  const feature = STREAM_FEATURES.find(
    (f) => f.name === 'caption-translation',
  )!;

  const image = (tracks: unknown[]) => ({
    __edb_e__: { S: 'contentItem' },
    courseId: { S: 'c1' },
    moduleId: { S: 'm1' },
    lessonId: { S: 'l1' },
    contentItemId: { S: 'i1' },
    captionTracks: { L: tracks },
  });
  const record = (sequence: string, oldImage: object, newImage: object) =>
    ({
      eventID: `e${sequence}`,
      eventName: 'MODIFY',
      eventSource: 'aws:dynamodb',
      eventVersion: '1.1',
      awsRegion: 'local',
      eventSourceARN: 'arn:aws:dynamodb:local:000000000000:table/t/stream/1',
      dynamodb: {
        Keys: { pk: { S: 'x' }, sk: { S: sequence } },
        SequenceNumber: sequence,
        SizeBytes: 1,
        StreamViewType: 'NEW_AND_OLD_IMAGES',
        OldImage: oldImage,
        NewImage: newImage,
      },
    }) as unknown as DynamoDBRecord;

  it('gets a changed default track to the handler, which writes the [es-ES] track', async () => {
    let time = 0;
    const queue = createInProcessQueue({ now: () => time });
    const route = createStreamRouter({
      queue,
      queueFor: (name) => `q-${name}`,
      failureQueue: 'router-failures',
      features: [feature],
    });
    const runner = createFeatureRunner({
      feature,
      queue,
      queueName: 'q-caption-translation',
      failureQueueName: 'f-caption-translation',
      run: async (event) => {
        await captionTranslation(DynamoDBStreamSchema.parse(event), {
          getRemainingTimeInMillis: () => 600_000,
        });
      },
      log: () => {},
      sleep: async (ms) => {
        time += ms;
      },
      now: () => time,
    });

    await route({
      Records: [
        record('1', image([]), image([{ M: { trackId: { S: 'src' } } }])),
        // A title-style change with the same tracks is not routed.
        record('2', image([]), image([])),
      ],
    });
    expect(await queue.depth('q-caption-translation')).toEqual({
      waiting: 1,
      inFlight: 0,
    });

    expect(await runner.runOnce()).toBe(true);
    const tracks = h.item.captionTracks as {
      language: string;
      source: string;
      key: string;
    }[];
    expect(tracks.map((t) => [t.language, t.source])).toEqual([
      ['en-US', 'auto'],
      ['es-ES', 'translated'],
    ]);
    expect(h.puts.get(tracks[1].key)).toContain('[es-ES] Hello');
  });
});
