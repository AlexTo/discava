/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { createTemplateLoader } from './template.js';

describe('createTemplateLoader', () => {
  it('sends the cached ETag and reuses the body on 304', async () => {
    const source = vi
      .fn()
      .mockResolvedValueOnce({ body: 'one', etag: 'e1' })
      .mockResolvedValueOnce({ notModified: true });
    const load = createTemplateLoader(source);
    expect(await load()).toBe('one');
    expect(await load()).toBe('one');
    expect(source).toHaveBeenNthCalledWith(1, undefined);
    expect(source).toHaveBeenNthCalledWith(2, 'e1');
  });

  it('replaces the body when the ETag changed', async () => {
    const source = vi
      .fn()
      .mockResolvedValueOnce({ body: 'one', etag: 'e1' })
      .mockResolvedValueOnce({ body: 'two', etag: 'e2' });
    const load = createTemplateLoader(source);
    await load();
    expect(await load()).toBe('two');
  });

  it('throws on a failed read instead of using the cached body', async () => {
    const source = vi
      .fn()
      .mockResolvedValueOnce({ body: 'one', etag: 'e1' })
      .mockRejectedValueOnce(new Error('S3 down'));
    const load = createTemplateLoader(source);
    await load();
    await expect(load()).rejects.toThrow('S3 down');
  });
});
