/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearGradingDraft,
  readGradingDraft,
  writeGradingDraft,
} from './grading-draft';

const ref = { courseId: 'c1', contentItemId: 'i1', userId: 'u1' };

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('grading draft', () => {
  it('round-trips points and feedback under its key', () => {
    writeGradingDraft(ref, { points: '7.5', feedback: '{"type":"doc"}' });

    expect(
      localStorage.getItem('discava:grading-draft:c1:i1:u1'),
    ).not.toBeNull();
    expect(readGradingDraft(ref)).toEqual({
      points: '7.5',
      feedback: '{"type":"doc"}',
    });
  });

  it('keeps one draft per student', () => {
    writeGradingDraft(ref, { points: '1' });

    expect(readGradingDraft({ ...ref, userId: 'u2' })).toBeNull();
  });

  it('clears a draft', () => {
    writeGradingDraft(ref, { points: '1' });
    clearGradingDraft(ref);

    expect(readGradingDraft(ref)).toBeNull();
  });

  it('reads nothing from a corrupt draft', () => {
    localStorage.setItem('discava:grading-draft:c1:i1:u1', '{nope');

    expect(readGradingDraft(ref)).toBeNull();
  });

  it('treats storage that throws as no draft', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(readGradingDraft(ref)).toBeNull();
    expect(() => writeGradingDraft(ref, { points: '1' })).not.toThrow();
    expect(() => clearGradingDraft(ref)).not.toThrow();
  });
});
