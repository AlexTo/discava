/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DynamoDBStreamSchema } from '@aws-lambda-powertools/parser/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

const h = vi.hoisted(() => ({
  translateVideoCaptions: vi.fn(),
  requestCaptionTranslation: vi.fn(),
  course: vi.fn(),
  preview: vi.fn(),
  curriculum: vi.fn(),
}));

vi.mock('./caption-translation-outcome.js', () => ({
  translateVideoCaptions: h.translateVideoCaptions,
}));
vi.mock('./transcode-outcome.js', () => ({
  getCoreTable: vi.fn(async () => ({
    entities: {
      course: { get: () => ({ go: async () => ({ data: h.course() }) }) },
      coursePreview: {
        get: () => ({ go: async () => ({ data: h.preview() }) }),
      },
    },
    collections: {
      curriculum: () => ({ go: async () => ({ data: h.curriculum() }) }),
    },
  })),
}));
vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  requestCaptionTranslation: h.requestCaptionTranslation,
}));

const { captionTranslation } = await import('./caption-translation.js');

type StreamEvent = z.infer<typeof DynamoDBStreamSchema>;

const event = (...images: Record<string, unknown>[]) =>
  ({
    Records: images.map((NewImage) => ({
      eventName: 'MODIFY',
      dynamodb: { NewImage },
    })),
  }) as unknown as StreamEvent;
const context = { getRemainingTimeInMillis: () => 600_000 };

const item = (contentItemId: string) => ({
  __edb_e__: 'contentItem',
  courseId: 'c1',
  moduleId: 'm1',
  lessonId: 'l1',
  contentItemId,
});
const courseRecord = { __edb_e__: 'course', courseId: 'c1' };

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.course.mockReturnValue({ courseId: 'c1' });
  h.preview.mockReturnValue(undefined);
  h.curriculum.mockReturnValue({ contentItem: [] });
});

describe('captionTranslation', () => {
  it('translates a content item and a preview record', async () => {
    await captionTranslation(
      event(item('i1'), { __edb_e__: 'coursePreview', courseId: 'c1' }),
      context,
    );
    expect(h.translateVideoCaptions.mock.calls.map((c) => c[2])).toEqual([
      { courseId: 'c1', moduleId: 'm1', lessonId: 'l1', contentItemId: 'i1' },
      { courseId: 'c1' },
    ]);
    expect(h.translateVideoCaptions.mock.calls[0][3]).toEqual({
      remainingMs: 600_000,
    });
    expect(h.requestCaptionTranslation).not.toHaveBeenCalled();
  });

  it('handles a video named twice in a batch once, in either order', async () => {
    await captionTranslation(
      event(item('i1'), item('i2'), item('i1')),
      context,
    );
    expect(h.translateVideoCaptions).toHaveBeenCalledTimes(2);
    h.translateVideoCaptions.mockClear();
    await captionTranslation(event(item('i2'), item('i1')), context);
    expect(
      h.translateVideoCaptions.mock.calls.map((c) => c[2].contentItemId).sort(),
    ).toEqual(['i1', 'i2']);
  });

  it('asks each video with caption tracks of a changed course, and translates nothing', async () => {
    const video = (contentItemId: string, tracks?: unknown[]) => ({
      type: 'video',
      moduleId: 'm1',
      lessonId: 'l1',
      contentItemId,
      captionTracks: tracks,
    });
    h.curriculum.mockReturnValue({
      contentItem: [
        video('with', [{}]),
        video('without'),
        { ...video('text', [{}]), type: 'text' },
      ],
    });
    h.preview.mockReturnValue({ captionTracks: [{}] });
    await captionTranslation(event(courseRecord), context);
    expect(h.requestCaptionTranslation.mock.calls.map((c) => c[1])).toEqual([
      { courseId: 'c1', moduleId: 'm1', lessonId: 'l1', contentItemId: 'with' },
      { courseId: 'c1' },
    ]);
    expect(h.translateVideoCaptions).not.toHaveBeenCalled();
  });

  it('does nothing for a course with no videos or no longer there', async () => {
    await captionTranslation(event(courseRecord), context);
    h.course.mockReturnValue(undefined);
    await captionTranslation(event(courseRecord), context);
    expect(h.requestCaptionTranslation).not.toHaveBeenCalled();
  });

  it('throws for a record it cannot identify', async () => {
    await expect(
      captionTranslation(
        event({ __edb_e__: 'lesson', courseId: 'c1' }),
        context,
      ),
    ).rejects.toThrow();
    await expect(
      captionTranslation(
        event({ __edb_e__: 'contentItem', courseId: 'c1' }),
        context,
      ),
    ).rejects.toThrow(/moduleId/);
  });

  it('fails the batch when a video fails, so the queue retries', async () => {
    h.translateVideoCaptions.mockRejectedValue(new Error('throttled'));
    await expect(
      captionTranslation(event(item('i1')), context),
    ).rejects.toThrow('throttled');
  });
});
