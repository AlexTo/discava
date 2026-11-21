/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  FREE_PREVIEW_COOKIE_LIFETIME_SECONDS,
  manifestNonce,
  previewManifestNonce,
  RETIRED_VERSION_DELAY_MINUTES,
  SIGNED_COOKIE_LIFETIME_SECONDS,
} from './media-keys.js';

describe('FREE_PREVIEW_COOKIE_LIFETIME_SECONDS', () => {
  it('is an hour, no longer than any other signed cookie', () => {
    expect(FREE_PREVIEW_COOKIE_LIFETIME_SECONDS).toBe(3600);
    expect(FREE_PREVIEW_COOKIE_LIFETIME_SECONDS).toBeLessThanOrEqual(
      SIGNED_COOKIE_LIFETIME_SECONDS,
    );
    expect(RETIRED_VERSION_DELAY_MINUTES * 60).toBeGreaterThan(
      FREE_PREVIEW_COOKIE_LIFETIME_SECONDS,
    );
  });
});

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

describe('previewManifestNonce', () => {
  it('reads the nonce from a preview manifest key', () => {
    expect(previewManifestNonce('courses/c1/preview/n1/master.m3u8')).toBe(
      'n1',
    );
  });

  it('is undefined for a lesson video key or a preview file outside a nonce folder', () => {
    expect(
      previewManifestNonce(
        'courses/c/modules/m/lessons/l/content-items/i/n1/master.m3u8',
      ),
    ).toBeUndefined();
    expect(
      previewManifestNonce('courses/c1/preview/master.m3u8'),
    ).toBeUndefined();
  });
});
