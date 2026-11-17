/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  ContentItemSchema,
  UpdateContentItemVideoOutputSchema,
} from './content-item.js';

const base = {
  contentItemId: 'i1',
  lessonId: 'l1',
  moduleId: 'm1',
  courseId: 'c1',
  status: 'ready',
  title: 'Lecture',
  order: 1,
  visibility: 'visible',
  studentActivityCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const FOLDER = 'courses/c1/modules/m1/lessons/l1/content-items/i1/n1';
const video = {
  ...base,
  type: 'video',
  s3Key: `${FOLDER}/master.m3u8`,
  mimeType: 'video/mp4',
  captionTracks: [
    {
      trackId: 't1',
      nonce: 'n1',
      language: 'en-US',
      label: 'English',
      source: 'auto',
      key: `${FOLDER}/captions/t1.vtt`,
      isDefault: true,
    },
  ],
  captionTracksRev: 3,
  captionsStatus: 'ready',
};

describe('a video content item output', () => {
  it.each([
    ['ContentItemSchema', ContentItemSchema],
    ['UpdateContentItemVideoOutputSchema', UpdateContentItemVideoOutputSchema],
  ])('carries the caption status and track count only (%s)', (_, schema) => {
    const output = schema.parse(video) as Record<string, unknown>;
    expect(output).toMatchObject({
      captionsStatus: 'ready',
      captionTrackCount: 1,
    });
    expect(output).not.toHaveProperty('captionTracks');
    expect(output).not.toHaveProperty('captionTracksRev');
    expect(JSON.stringify(output)).not.toContain('captions/t1.vtt');
  });

  it('leaves the status and count out for a video never captioned', () => {
    const { captionTracks, captionTracksRev, captionsStatus, ...plain } = video;
    const output = ContentItemSchema.parse(plain);
    expect(output).not.toHaveProperty('captionTrackCount');
    expect(output).not.toHaveProperty('captionsStatus');
  });

  it('reports a pending status older than two hours as failed', () => {
    const output = ContentItemSchema.parse({
      ...video,
      captionsStatus: 'pending',
      captionsPendingSince: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    });
    expect(output).toMatchObject({ captionsStatus: 'failed' });
  });

  it('leaves other item types alone', () => {
    const output = ContentItemSchema.parse({
      ...base,
      type: 'text',
      body: '{}',
    });
    expect(output).not.toHaveProperty('captionTrackCount');
    expect(output).not.toHaveProperty('captionsStatus');
  });
});
