/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  isValidPosition,
  resumeAt,
  VIDEO_POSITION_MAX_SECONDS,
  videoPositionToStore,
} from './video-position.js';

describe('isValidPosition', () => {
  it.each([0, 1, 90, VIDEO_POSITION_MAX_SECONDS])('accepts %s', (n) => {
    expect(isValidPosition(n)).toBe(true);
  });

  it.each([
    -1,
    1.5,
    VIDEO_POSITION_MAX_SECONDS + 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '5',
    undefined,
    null,
  ])('rejects %s', (n) => {
    expect(isValidPosition(n)).toBe(false);
  });
});

describe('videoPositionToStore', () => {
  it('floors a fractional position', () => {
    expect(videoPositionToStore(42.9, 600)).toBe(42);
  });

  it('keeps a position well before the end', () => {
    expect(videoPositionToStore(300, 600)).toBe(300);
  });

  it('stores 0 within 10 seconds of the end', () => {
    expect(videoPositionToStore(590, 600)).toBe(0);
    expect(videoPositionToStore(595, 600)).toBe(0);
  });

  it('keeps a position over 10 seconds from the end, under 95%', () => {
    expect(videoPositionToStore(89, 100)).toBe(89);
  });

  it('stores 0 from 95% of the duration', () => {
    expect(videoPositionToStore(19000, 20000)).toBe(0);
    expect(videoPositionToStore(18999, 20000)).toBe(18999);
  });

  it('counts a video of 10 seconds or less as finished only at its end', () => {
    expect(videoPositionToStore(3, 8)).toBe(3);
    expect(videoPositionToStore(8, 8)).toBe(0);
  });

  it('stores 0 for a position past the end', () => {
    expect(videoPositionToStore(700, 600)).toBe(0);
  });
});

describe('resumeAt', () => {
  it('returns the stored position for the played version', () => {
    expect(resumeAt({ versionId: 'v1', positionSeconds: 42 }, 'v1')).toBe(42);
  });

  it('returns 0 for another version', () => {
    expect(resumeAt({ versionId: 'v1', positionSeconds: 42 }, 'v2')).toBe(0);
  });

  it('returns 0 with no record', () => {
    expect(resumeAt(undefined, 'v1')).toBe(0);
  });
});
