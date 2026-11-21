/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { asStudentContentItem } from './playback.js';

const NEW = 'item-1.mp4';
const OLD = 'item-1/old/master.m3u8';
const READY = 'item-1/new/master.m3u8';

describe('asStudentContentItem', () => {
  it('shows a video being replaced as ready, with the version students can play', () => {
    expect(
      asStudentContentItem({
        type: 'video',
        status: 'pending',
        s3Key: NEW,
        previousS3Key: OLD,
      }),
    ).toMatchObject({ status: 'ready', s3Key: OLD });
  });

  it('leaves a first upload still transcoding, and other items, alone', () => {
    const pending = { type: 'video', status: 'pending', s3Key: NEW };
    const text = { type: 'text', status: 'ready' };

    expect(asStudentContentItem(pending)).toBe(pending);
    expect(asStudentContentItem(text)).toBe(text);
  });
});

describe('asStudentContentItem, caption attributes', () => {
  const captioned = {
    type: 'video',
    status: 'ready',
    s3Key: READY,
    captionTracks: [{ trackId: 't1', key: 'item-1/new/captions/t1.vtt' }],
    captionTracksRev: 3,
    captionsStatus: 'ready',
    captionsPendingSince: '2026-01-01T00:00:00.000Z',
  };

  it('drops them from a ready video, keeping the rest', () => {
    expect(asStudentContentItem(captioned)).toEqual({
      type: 'video',
      status: 'ready',
      s3Key: READY,
    });
  });

  it('drops them from a video being replaced as well', () => {
    expect(
      asStudentContentItem({
        ...captioned,
        status: 'pending',
        s3Key: NEW,
        previousS3Key: OLD,
      }),
    ).toEqual({
      type: 'video',
      status: 'ready',
      s3Key: OLD,
      previousS3Key: OLD,
    });
  });

  it('does not change the record it was given', () => {
    asStudentContentItem(captioned);
    expect(captioned).toHaveProperty('captionTracks');
  });
});
