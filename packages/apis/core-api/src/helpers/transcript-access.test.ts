/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  aContentItem,
  aLesson,
  aModule,
} from '@discava/common-server-utils/trpc-testing';
import { describe, expect, it } from 'vitest';
import { watchableVideos } from './transcript-access.js';

const manifest = (nonce: string) =>
  `courses/course-1/content-items/content-item-1/${nonce}/master.m3u8`;

const track = (trackId: string, nonce: string, isDefault = false) => ({
  trackId,
  nonce,
  language: 'en',
  label: 'English',
  source: 'auto' as const,
  key: `k/${trackId}.vtt`,
  isDefault,
});

const video = (overrides: Record<string, unknown> = {}) =>
  aContentItem({
    s3Key: manifest('v1'),
    captionTracks: [track('t1', 'v1', true)],
    ...overrides,
  });

const curriculum = ({
  module = {},
  lesson = {},
  item = video(),
}: {
  module?: Record<string, unknown>;
  lesson?: Record<string, unknown>;
  item?: ReturnType<typeof video>;
} = {}) => ({
  modules: [aModule(module)],
  lessons: [aLesson(lesson)],
  contentItems: [item],
});

describe('watchableVideos', () => {
  it('lists a shown captioned video with its version and tracks', () => {
    expect(watchableVideos(curriculum())).toEqual([
      {
        contentItemId: 'content-item-1',
        moduleId: 'module-1',
        lessonId: 'lesson-1',
        versionId: 'v1',
        trackIds: ['t1'],
      },
    ]);
  });

  it.each([
    ['a hidden item', curriculum({ item: video({ visibility: 'hidden' }) })],
    [
      'an archived item',
      curriculum({ item: video({ archivedAt: '2026-01-01T00:00:00.000Z' }) }),
    ],
    ['a hidden lesson', curriculum({ lesson: { visibility: 'hidden' } })],
    [
      'an archived lesson',
      curriculum({ lesson: { archivedAt: '2026-01-01T00:00:00.000Z' } }),
    ],
    ['a hidden module', curriculum({ module: { visibility: 'hidden' } })],
    [
      'an archived module',
      curriculum({ module: { archivedAt: '2026-01-01T00:00:00.000Z' } }),
    ],
    ['a non-video', curriculum({ item: video({ type: 'text' }) })],
    [
      'a first upload still transcoding',
      curriculum({ item: video({ status: 'processing' }) }),
    ],
    [
      'a video with no tracks',
      curriculum({ item: video({ captionTracks: [] }) }),
    ],
  ])('leaves out %s', (_, input) => {
    expect(watchableVideos(input)).toEqual([]);
  });

  it('gives the previous version and its tracks for a video being replaced', () => {
    const item = video({
      status: 'processing',
      s3Key: manifest('v2'),
      previousS3Key: manifest('v1'),
      captionTracks: [track('t1', 'v1', true), track('t2', 'v2', true)],
    });
    expect(watchableVideos(curriculum({ item }))).toMatchObject([
      { versionId: 'v1', trackIds: ['t1'] },
    ]);
  });
});
