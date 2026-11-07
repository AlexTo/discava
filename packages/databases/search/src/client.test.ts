/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveEndpoint, resolveIndexName } from './client.js';

describe('resolveEndpoint', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses OPENSEARCH_ENDPOINT without asking AppConfig', async () => {
    // The index-sync handler runs before AppConfig has anything in it, so
    // with no RUNTIME_CONFIG_APP_ID this must not touch it at all.
    vi.stubEnv('LOCAL_DEV', '');
    vi.stubEnv('RUNTIME_CONFIG_APP_ID', '');
    vi.stubEnv(
      'OPENSEARCH_ENDPOINT',
      'https://abc.ap-southeast-2.aoss.amazonaws.com',
    );

    await expect(resolveEndpoint()).resolves.toBe(
      'https://abc.ap-southeast-2.aoss.amazonaws.com',
    );
  });
});

describe('resolveIndexName', () => {
  it('resolves every index defined under src/indices', () => {
    expect(resolveIndexName('courses')).toBe('courses');
  });

  it('throws for a name no index was defined with', () => {
    // @ts-expect-error -- deliberately not a known IndexName
    expect(() => resolveIndexName('not-a-real-index')).toThrow(
      /Unknown search index/,
    );
  });
});
