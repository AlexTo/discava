/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';

describe('colour', () => {
  it('is a module', async () => {
    expect(await import('./colour.js')).toBeDefined();
  });
});
