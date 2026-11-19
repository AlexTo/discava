/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  hasMetadata,
  isRetryOfInFlightSubmission,
  pickSubmissionNonce,
  requireObjectKeyInLesson,
  type StoredVideoItem,
} from './video-replacement.js';

const item = (fields: Partial<StoredVideoItem>) =>
  ({
    status: 'pending',
    s3Key: 'key.mp4',
    ...fields,
  }) as StoredVideoItem;

describe('isRetryOfInFlightSubmission', () => {
  const inFlight = item({ mediaConvertJobId: 'job', rawObjectETag: 'etag' });

  it('is true for the same key and content already mid-transcode', () => {
    expect(isRetryOfInFlightSubmission(inFlight, 'key.mp4', 'etag')).toBe(true);
  });

  it('is false when the upload content changed', () => {
    expect(isRetryOfInFlightSubmission(inFlight, 'key.mp4', 'other')).toBe(
      false,
    );
  });

  it('is false for a different key, no job yet, or a non-pending item', () => {
    expect(isRetryOfInFlightSubmission(inFlight, 'new.mp4', 'etag')).toBe(
      false,
    );
    expect(
      isRetryOfInFlightSubmission(
        item({ rawObjectETag: 'etag' }),
        'key.mp4',
        'etag',
      ),
    ).toBe(false);
    expect(
      isRetryOfInFlightSubmission(
        { ...inFlight, status: 'ready' },
        'key.mp4',
        'etag',
      ),
    ).toBe(false);
  });
});

describe('pickSubmissionNonce', () => {
  it('reuses the nonce of a pending replacement whose job was never stamped', () => {
    expect(
      pickSubmissionNonce(item({ submissionNonce: 'nonce-1' }), 'key.mp4'),
    ).toBe('nonce-1');
  });

  it.each([
    ['a different key', item({ submissionNonce: 'n' }), 'new.mp4'],
    [
      'a job already stamped',
      item({ submissionNonce: 'n', mediaConvertJobId: 'job' }),
      'key.mp4',
    ],
    [
      'a ready item',
      item({ submissionNonce: 'n', status: 'ready' }),
      'key.mp4',
    ],
    ['no stored nonce', item({}), 'key.mp4'],
  ])('mints a fresh nonce for %s', (_name, existing, objectKey) => {
    const nonce = pickSubmissionNonce(existing, objectKey);
    expect(nonce).not.toBe('n');
    expect(nonce).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('requireObjectKeyInLesson', () => {
  const key = {
    courseId: 'c',
    moduleId: 'm',
    lessonId: 'l',
    contentItemId: 'i',
  };

  it('accepts a key under the lesson', () => {
    expect(() =>
      requireObjectKeyInLesson(
        key,
        'courses/c/modules/m/lessons/l/content-items/i/video.mp4',
      ),
    ).not.toThrow();
  });

  it("rejects another lesson's key", () => {
    expect(() =>
      requireObjectKeyInLesson(
        key,
        'courses/c/modules/m/lessons/x/content-items/i/video.mp4',
      ),
    ).toThrow('objectKey does not match this lesson');
  });
});

describe('hasMetadata', () => {
  it('ignores undefined fields', () => {
    expect(hasMetadata({ title: undefined })).toBe(false);
    expect(hasMetadata({ durationSeconds: 0 })).toBe(true);
  });
});
