/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { resolveIndexName } from './client.js';

describe('resolveIndexName', () => {
  it('resolves every index defined under src/indices', () => {
    expect(resolveIndexName('courses')).toBe('courses');
    expect(resolveIndexName('lessons')).toBe('lessons');
  });

  it('throws for a name no index was defined with', () => {
    // @ts-expect-error -- deliberately not a known IndexName
    expect(() => resolveIndexName('not-a-real-index')).toThrow(
      /Unknown search index/,
    );
  });
});
