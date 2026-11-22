/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveSettings: vi.fn(),
  createCoreTableService: vi.fn(),
}));

vi.mock('./helpers/page-renderer-settings.js', () => ({
  resolvePageRendererSettings: mocks.resolveSettings,
}));
vi.mock('@discava/core-table', () => ({
  createCoreTableService: mocks.createCoreTableService,
}));
vi.mock('../helpers/sitemap.js', () => ({ sitemapEntries: async () => [] }));
vi.mock('../router.js', () => ({
  appRouter: { createCaller: () => ({}) },
}));

const sitemap = {
  rawPath: '/sitemap.xml',
  headers: {},
  requestContext: { http: { method: 'GET' } },
};

describe('the configured page renderer', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.resolveSettings.mockReset();
    mocks.createCoreTableService.mockReset();
    vi.stubEnv('LOCAL_DEV', '');
    vi.stubEnv('DISCAVA_DYNAMODB_CORE_TABLE', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('reads the parameter once and hands the table name to core-table', async () => {
    mocks.resolveSettings.mockResolvedValue({
      tableName: 'core',
      publicMediaBaseUrl: 'https://media.example.com/',
    });
    mocks.createCoreTableService.mockImplementation(async () => ({
      tableNameSeen: process.env.DISCAVA_DYNAMODB_CORE_TABLE,
    }));
    const { createConfiguredPageRenderer } = await import('./handler.js');
    const render = createConfiguredPageRenderer();

    expect((await render(sitemap)).statusCode).toBe(200);
    expect((await render(sitemap)).statusCode).toBe(200);

    expect(mocks.resolveSettings).toHaveBeenCalledTimes(1);
    expect(mocks.createCoreTableService).toHaveBeenCalledTimes(1);
    expect(process.env.DISCAVA_DYNAMODB_CORE_TABLE).toBe(
      '{"tableName":"core"}',
    );
  });

  it('answers 503 when the parameter cannot be read, then retries', async () => {
    mocks.resolveSettings.mockRejectedValueOnce(new Error('denied'));
    mocks.resolveSettings.mockResolvedValue({
      tableName: 'core',
      publicMediaBaseUrl: 'https://media.example.com/',
    });
    mocks.createCoreTableService.mockResolvedValue({});
    const { createConfiguredPageRenderer } = await import('./handler.js');
    const render = createConfiguredPageRenderer();

    expect((await render(sitemap)).statusCode).toBe(503);
    expect((await render(sitemap)).statusCode).toBe(200);
  });
});
