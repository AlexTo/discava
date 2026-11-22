/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';

describe('brand', () => {
  it('is a module', async () => {
    expect(await import('./brand.js')).toBeDefined();
  });
});
