/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { STREAM_FEATURES } from '@discava/core-table';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@discava/search', () => ({
  getOpenSearchClient: vi.fn(),
  resolveIndexName: (name: string) => name,
}));

import { HANDLERS } from './handlers.js';

describe('HANDLERS', () => {
  it.each(STREAM_FEATURES.map((feature) => [feature.name, feature.handler]))(
    'has a handler for feature %s',
    (_name, handler) => {
      expect(Object.keys(HANDLERS)).toContain(handler);
      expect(typeof HANDLERS[handler as keyof typeof HANDLERS]).toBe(
        'function',
      );
    },
  );

  it('names no handler that no feature uses', () => {
    expect(Object.keys(HANDLERS).sort()).toEqual(
      STREAM_FEATURES.map((feature) => feature.handler).sort(),
    );
  });
});
