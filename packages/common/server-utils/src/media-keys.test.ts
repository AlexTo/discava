/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { manifestNonce } from './media-keys.js';

describe('manifestNonce', () => {
  it('reads the nonce folder a manifest lives under', () => {
    expect(
      manifestNonce(
        'courses/c/modules/m/lessons/l/content-items/item-1/nonce-1/master.m3u8',
      ),
    ).toBe('nonce-1');
  });

  it('has none for a manifest from before nonces', () => {
    expect(
      manifestNonce(
        'courses/c/modules/m/lessons/l/content-items/item-1/master.m3u8',
      ),
    ).toBeUndefined();
  });
});
