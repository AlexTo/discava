/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { asStudentContentItem, playableManifest } from './playback.js';

const NEW = 'item-1.mp4';
const OLD = 'item-1/old/master.m3u8';
const READY = 'item-1/new/master.m3u8';

describe('playableManifest', () => {
  it.each([
    ['a ready video', { status: 'ready', s3Key: READY }, READY],
    [
      'a video being replaced',
      { status: 'pending', s3Key: NEW, previousS3Key: OLD },
      OLD,
    ],
    [
      'a failed replacement',
      { status: 'failed', s3Key: NEW, previousS3Key: OLD },
      OLD,
    ],
    [
      'a first upload still transcoding',
      { status: 'pending', s3Key: NEW },
      undefined,
    ],
  ])('for %s', (_, item, expected) => {
    expect(playableManifest(item)).toBe(expected);
  });
});

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
