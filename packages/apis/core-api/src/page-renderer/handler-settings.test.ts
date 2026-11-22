/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveSettings: vi.fn(),
  createCoreTableService: vi.fn(),
  caller: vi.fn(() => ({})),
}));

vi.mock('./helpers/page-renderer-settings.js', () => ({
  resolvePageRendererSettings: mocks.resolveSettings,
}));
vi.mock('@discava/core-table', () => ({
  createCoreTableService: mocks.createCoreTableService,
}));
vi.mock('../helpers/sitemap.js', () => ({ sitemapEntries: async () => [] }));
vi.mock('@discava/common-server-utils/lesson-media-bucket', () => ({
  getS3Client: () => ({
    send: async () => ({
      Body: {
        transformToString: async () =>
          '<html><head><title>Discava</title></head><body><div id="root"></div></body></html>',
      },
    }),
  }),
}));
vi.mock('../router.js', () => ({
  appRouter: { createCaller: mocks.caller },
}));

const page = (rawPath: string) => ({
  rawPath,
  headers: {},
  requestContext: { http: { method: 'GET' } },
});

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
    mocks.caller.mockReset();
    mocks.caller.mockReturnValue({});
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

  it('has the table setting in place before a course page runs a procedure', async () => {
    mocks.resolveSettings.mockResolvedValue({
      tableName: 'core',
      publicMediaBaseUrl: 'https://media.example.com/',
    });
    mocks.createCoreTableService.mockResolvedValue({});
    let seen: string | undefined;
    mocks.caller.mockReturnValue({
      review: {
        summary: async () => ({ count: 0 }),
        list: async () => ({ items: [], cursor: null }),
      },
      course: {
        publicView: async () => {
          seen = process.env.DISCAVA_DYNAMODB_CORE_TABLE;
          throw new TRPCError({ code: 'NOT_FOUND' });
        },
      },
    });
    const { createConfiguredPageRenderer } = await import('./handler.js');

    const response = await createConfiguredPageRenderer()(page('/learn/c1'));

    expect(response.statusCode).toBe(404);
    expect(seen).toBe('{"tableName":"core"}');
  });
});
