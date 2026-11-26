/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveEndpoint, resolveIndexName } from './client.js';

describe('resolveEndpoint', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('reads the endpoint from DISCAVA_OPENSEARCH_SEARCH_ENDPOINT', async () => {
    vi.stubEnv('LOCAL_DEV', '');
    vi.stubEnv(
      'DISCAVA_OPENSEARCH_SEARCH_ENDPOINT',
      'https://abc.ap-southeast-2.aoss.amazonaws.com',
    );

    await expect(resolveEndpoint()).resolves.toBe(
      'https://abc.ap-southeast-2.aoss.amazonaws.com',
    );
  });

  it('names the setting when it is absent', async () => {
    vi.stubEnv('LOCAL_DEV', '');
    vi.stubEnv('DISCAVA_OPENSEARCH_SEARCH_ENDPOINT', '');

    await expect(resolveEndpoint()).rejects.toThrow(
      'Missing deploy-time setting DISCAVA_OPENSEARCH_SEARCH_ENDPOINT',
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
