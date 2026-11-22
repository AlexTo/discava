/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetPageRendererSettings,
  resolvePageRendererSettings,
} from './page-renderer-settings.js';

const VALUE = JSON.stringify({
  tableName: 'core',
  publicMediaBaseUrl: 'https://media.example.com/',
});
const client = (value: string | undefined = VALUE) => ({
  send: vi.fn(async () => ({ Parameter: { Value: value } })),
});

describe('resolvePageRendererSettings', () => {
  beforeEach(() => {
    resetPageRendererSettings();
    vi.stubEnv('PAGE_RENDERER_PARAMETER', '/discava-development/page-renderer');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('parses the parameter', async () => {
    const fake = client();
    await expect(resolvePageRendererSettings(fake)).resolves.toEqual({
      tableName: 'core',
      publicMediaBaseUrl: 'https://media.example.com/',
    });
    expect(fake.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { Name: '/discava-development/page-renderer' },
      }),
    );
  });

  it('makes one call for several concurrent and later requests', async () => {
    const fake = client();
    await Promise.all([
      resolvePageRendererSettings(fake),
      resolvePageRendererSettings(fake),
    ]);
    await resolvePageRendererSettings(fake);
    expect(fake.send).toHaveBeenCalledTimes(1);
  });

  it('retries after a failure', async () => {
    const fake = client();
    fake.send.mockRejectedValueOnce(new Error('throttled'));
    await expect(resolvePageRendererSettings(fake)).rejects.toThrow(
      'throttled',
    );
    await expect(resolvePageRendererSettings(fake)).resolves.toMatchObject({
      tableName: 'core',
    });
    expect(fake.send).toHaveBeenCalledTimes(2);
  });

  it('names PAGE_RENDERER_PARAMETER when it is unset', async () => {
    vi.stubEnv('PAGE_RENDERER_PARAMETER', '');
    const fake = client();
    await expect(resolvePageRendererSettings(fake)).rejects.toThrow(
      'PAGE_RENDERER_PARAMETER',
    );
    expect(fake.send).not.toHaveBeenCalled();
  });

  it.each(['tableName', 'publicMediaBaseUrl'])(
    'names the missing %s',
    async (field) => {
      const value = JSON.parse(VALUE);
      delete value[field];
      await expect(
        resolvePageRendererSettings(client(JSON.stringify(value))),
      ).rejects.toThrow(field);
    },
  );
});
