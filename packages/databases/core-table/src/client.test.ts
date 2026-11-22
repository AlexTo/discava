/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveTableName } from './client.js';

describe('resolveTableName', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('reads the table name from DISCAVA_DYNAMODB_CORE_TABLE', async () => {
    vi.stubEnv('LOCAL_DEV', '');
    vi.stubEnv('DISCAVA_DYNAMODB_CORE_TABLE', '{"tableName":"core"}');

    await expect(resolveTableName()).resolves.toBe('core');
  });

  it('names the setting when it is absent', async () => {
    vi.stubEnv('LOCAL_DEV', '');
    vi.stubEnv('DISCAVA_DYNAMODB_CORE_TABLE', '');

    await expect(resolveTableName()).rejects.toThrow(
      'Missing deploy-time setting DISCAVA_DYNAMODB_CORE_TABLE',
    );
  });

  it('names the setting when it has no table name', async () => {
    vi.stubEnv('LOCAL_DEV', '');
    vi.stubEnv('DISCAVA_DYNAMODB_CORE_TABLE', '{}');

    await expect(resolveTableName()).rejects.toThrow(
      'Could not resolve table name from DISCAVA_DYNAMODB_CORE_TABLE',
    );
  });

  it('does not read the setting in local dev', async () => {
    vi.stubEnv('LOCAL_DEV', 'true');
    vi.stubEnv('DISCAVA_DYNAMODB_CORE_TABLE', '{"tableName":"ignored"}');

    await expect(resolveTableName()).resolves.not.toBe('ignored');
  });
});
