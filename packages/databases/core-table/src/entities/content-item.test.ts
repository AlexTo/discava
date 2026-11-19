/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import {
  TRANSCODE_PENDING_ATTRIBUTES,
  transcodePendingFrom,
} from '../helpers/content-item.js';
import { createContentItemEntity } from './content-item.js';

// The requests ElectroDB would send, checked without a table: what keeps
// byTranscodePending (the transcode reconciler's index, #125) in step with
// whether a video is waiting for its transcode.

let contentItem: Awaited<ReturnType<typeof createContentItemEntity>>;
beforeAll(async () => {
  contentItem = await createContentItemEntity();
});

const key = {
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
  contentItemId: 'item-1',
};
const SINCE = new Date('2026-10-21T10:00:00.000Z');
const item = {
  ...key,
  title: 'Lecture',
  order: 1,
  visibility: 'visible' as const,
};

describe('byTranscodePending', () => {
  it('indexes a video created waiting for its transcode', () => {
    const { Item } = contentItem
      .create({
        ...item,
        type: 'video',
        status: 'pending',
        ...transcodePendingFrom(SINCE),
      })
      .params();

    expect(Item).toMatchObject({
      gsi1pk: expect.stringContaining('transcodepending_pending'),
      gsi1sk: expect.stringContaining(
        `transcodependingsince_${SINCE.toISOString()}`.toLowerCase(),
      ),
    });
  });

  it('leaves out everything else', () => {
    const { Item } = contentItem
      .create({ ...item, type: 'text', status: 'ready', body: '{}' })
      .params();

    expect(Item).not.toHaveProperty('gsi1pk');
    expect(Item).not.toHaveProperty('gsi1sk');
  });

  it('indexes a video replaced, writing both keys', () => {
    const { UpdateExpression } = contentItem
      .patch(key)
      .set({ status: 'pending', ...transcodePendingFrom(SINCE) })
      .params();

    expect(UpdateExpression).toContain('#gsi1pk = ');
    expect(UpdateExpression).toContain('#gsi1sk = ');
  });

  it('drops a video once it’s ready or failed', () => {
    const { UpdateExpression } = contentItem
      .patch(key)
      .set({ status: 'ready' })
      .remove([...TRANSCODE_PENDING_ATTRIBUTES])
      .params();

    expect(UpdateExpression).toMatch(/REMOVE .*#gsi1pk/);
    expect(UpdateExpression).toMatch(/REMOVE .*#gsi1sk/);
  });

  it('leaves the index alone for other edits', () => {
    const { UpdateExpression } = contentItem
      .patch(key)
      .set({ title: 'Renamed' })
      .params();

    expect(UpdateExpression).not.toContain('gsi1');
  });
});

describe('caption attributes', () => {
  const track = {
    trackId: 'track-1',
    nonce: 'n1',
    language: 'en-US',
    label: 'English',
    source: 'auto' as const,
    key: 'courses/c/modules/m/lessons/l/content-items/i/n1/captions/track-1.vtt',
    isDefault: true,
  };

  it('stores tracks, status and revision on a video', () => {
    const { Item } = contentItem
      .create({
        ...item,
        type: 'video',
        status: 'ready',
        captionTracks: [track],
        captionTracksRev: 1,
        captionsStatus: 'ready',
      })
      .params();

    expect(Item).toMatchObject({
      captionTracks: [track],
      captionTracksRev: 1,
      captionsStatus: 'ready',
    });
  });

  it('indexes nothing for them', () => {
    const { Item } = contentItem
      .create({
        ...item,
        type: 'video',
        status: 'ready',
        captionsStatus: 'pending',
        captionsPendingSince: SINCE.toISOString(),
      })
      .params();

    expect(Item).not.toHaveProperty('gsi1pk');
  });

  it('refuses a track whose source is neither auto nor uploaded', () => {
    expect(() =>
      contentItem
        .create({
          ...item,
          type: 'video',
          status: 'ready',
          captionTracks: [{ ...track, source: 'other' as never }],
        })
        .params(),
    ).toThrow();
  });

  it('patches the list with a revision condition', () => {
    const { UpdateExpression, ConditionExpression } = contentItem
      .patch(key)
      .set({ captionTracks: [track] })
      .add({ captionTracksRev: 1 })
      .where(
        (attr, op) =>
          `${op.eq(attr.captionTracksRev, 0)} AND ${op.contains(attr.s3Key, '/n1/')}`,
      )
      .params();

    expect(UpdateExpression).toContain('captionTracks');
    expect(UpdateExpression).toContain('ADD');
    expect(ConditionExpression).toContain('contains');
  });
});
