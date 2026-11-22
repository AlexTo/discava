/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import {
  createPageRenderer,
  type PageRendererDeps,
  type PageRendererEvent,
} from './handler.js';
import { createTemplateLoader } from './template.js';

vi.mock('../helpers/sitemap.js', () => ({
  sitemapEntries: async () => [
    { path: '/learn/c1', lastmod: '2026-01-01T00:00:00.000Z' },
    { path: '/instructors/ada', lastmod: '2026-01-02T00:00:00.000Z' },
  ],
}));

const TEMPLATE =
  '<html><head><title>Discava</title><script src="/assets/a.js"></script></head><body><div id="root"></div></body></html>';

const course = {
  courseId: 'c1',
  title: 'Intro to Rust',
  description: 'About',
  status: 'published',
  priceAmount: 0,
  priceCurrency: 'USD',
  createdAt: '',
  updatedAt: '',
  learningOutcomes: ['Write safe code'],
  requirements: [],
  instructors: [{ handle: 'Ada', displayName: 'Ada Lovelace' }],
  modules: [],
};
const profile = {
  handle: 'ada',
  displayName: 'Ada Lovelace',
  courses: [{ courseId: 'c1', title: 'Intro to Rust', ratingCount: 0 }],
};
const certificate = {
  certificateId: 'ABCD-EFGH-JKMN-PQRS',
  learnerName: 'Sam <b> "Q" & Co',
  courseTitle: 'Rust & "Go"',
  completedAt: '2026-11-19T23:30:00.000Z',
  completedOn: '19 November 2026',
};
const notFound = () => Promise.reject(new TRPCError({ code: 'NOT_FOUND' }));

const build = (overrides: Partial<PageRendererDeps> = {}, config = {}) => {
  const publicView = vi.fn(async ({ courseId }: { courseId: string }) =>
    courseId === 'c1' ? course : notFound(),
  );
  const profileView = vi.fn(async ({ handle }: { handle: string }) =>
    handle.toLowerCase() === 'ada' ? profile : notFound(),
  );
  const verify = vi.fn(async ({ certificateId }: { certificateId: string }) =>
    certificateId.replace(/-/g, '').toUpperCase() === 'ABCDEFGHJKMNPQRS'
      ? certificate
      : certificateId.length > 100
        ? Promise.reject(new TRPCError({ code: 'BAD_REQUEST' }))
        : notFound(),
  );
  const deps = {
    loadTemplate: async () => TEMPLATE,
    caller: {
      course: { publicView },
      review: {
        summary: async () => ({
          count: 0,
          stars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        }),
        list: async () => ({ items: [], cursor: null }),
      },
      instructorProfile: { publicView: profileView },
      certificate: { verify },
    },
    coreTable: async () => ({}),
    mediaBaseUrl: async () => 'https://media.example.com/',
    config: {
      allowIndexing: true,
      siteName: 'Discava',
      allowedHosts: ['learn.example.com'],
      fallbackHost: 'localhost',
      ...config,
    },
    ...overrides,
  } as unknown as PageRendererDeps;
  return {
    render: createPageRenderer(deps),
    publicView,
    profileView,
    verify,
  };
};

const get = (
  path: string,
  headers: Record<string, string> = {},
  method = 'GET',
): PageRendererEvent => ({
  rawPath: path,
  headers,
  requestContext: { http: { method } },
});

describe('page renderer', () => {
  it('renders a published course', async () => {
    const response = await build().render(get('/learn/c1'));
    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(response.headers['Cache-Control']).toBe(
      'public, max-age=0, s-maxage=300',
    );
    expect(response.body).toContain('<title>Intro to Rust | Discava</title>');
    expect(response.body).toContain('Write safe code');
    expect(response.body).toContain('/assets/a.js');
    expect(response.headers['X-Robots-Tag']).toBeUndefined();
  });

  it('renders a profile, with a mixed-case handle and a trailing slash', async () => {
    const response = await build().render(get('/instructors/ADA/'));
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Ada Lovelace');
    expect(response.body).toContain(
      'href="https://learn.example.com/instructors/ada"',
    );
  });

  it('renders a course with a trailing slash', async () => {
    const response = await build().render(get('/learn/c1/'));
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(
      'href="https://learn.example.com/learn/c1"',
    );
  });

  it('gives byte-identical 404s for every course that is not public', async () => {
    const { render } = build();
    const [a, b, c] = await Promise.all(
      ['draft-id', 'archived-id', 'unknown-id'].map((id) =>
        render(get(`/learn/${id}`)),
      ),
    );
    expect(a?.statusCode).toBe(404);
    expect(a?.body).toBe(b?.body);
    expect(b?.body).toBe(c?.body);
    expect(a?.headers['X-Robots-Tag']).toBe('noindex');
    expect(a?.headers['Cache-Control']).toBe('public, max-age=0, s-maxage=60');
    expect(a?.body).toContain('<title>Not found | Discava</title>');
    expect(a?.body).not.toContain('discava-page-data');
  });

  it('answers 404 for an unknown instructor and an unknown path', async () => {
    const { render } = build();
    expect((await render(get('/instructors/nobody'))).statusCode).toBe(404);
    expect((await render(get('/nope'))).statusCode).toBe(404);
  });

  it('serves the plain shell with noindex under /learn/<id>/…', async () => {
    const { render, publicView } = build();
    const response = await render(get('/learn/c1/home'));
    expect(response.statusCode).toBe(200);
    expect(response.headers['X-Robots-Tag']).toBe('noindex');
    expect(response.body).toContain('<meta name="robots" content="noindex" />');
    expect(response.body).not.toContain('Intro to Rust');
    expect(publicView).not.toHaveBeenCalled();
  });

  it('serves the plain noindex shell at the preview address, reading nothing', async () => {
    const entities = vi.fn(() => ({}));
    const table = Object.defineProperty({}, 'entities', { get: entities });
    const { render, publicView } = build({ coreTable: async () => table });
    const response = await render(get('/learn/c1/preview/l1'));
    expect(response.statusCode).toBe(200);
    expect(response.headers['X-Robots-Tag']).toBe('noindex');
    expect(response.body).toContain('<meta name="robots" content="noindex" />');
    expect(response.body).not.toContain('Intro to Rust');
    expect(response.body).not.toContain('discava-page-data');
    expect(publicView).not.toHaveBeenCalled();
    expect(entities).not.toHaveBeenCalled();
  });

  it('ignores a host that is not allowed', async () => {
    const { render } = build();
    const response = await render(
      get('/learn/c1', { 'x-discava-host': 'evil.example.net' }),
    );
    expect(response.body).toContain('https://learn.example.com/learn/c1');
    expect(response.body).not.toContain('evil.example.net');
  });

  it('uses an allowed host', async () => {
    const { render } = build(
      {},
      { allowedHosts: ['learn.example.com', 'www.example.com'] },
    );
    const response = await render(
      get('/learn/c1', { 'x-discava-host': 'www.example.com' }),
    );
    expect(response.body).toContain('https://www.example.com/learn/c1');
  });

  it('allows *.cloudfront.net only when no hosts are configured', async () => {
    const open = build({}, { allowedHosts: [] });
    expect(
      (
        await open.render(
          get('/learn/c1', { 'x-discava-host': 'd111.cloudfront.net' }),
        )
      ).body,
    ).toContain('https://d111.cloudfront.net/learn/c1');
    const closed = build();
    expect(
      (
        await closed.render(
          get('/learn/c1', { 'x-discava-host': 'd111.cloudfront.net' }),
        )
      ).body,
    ).not.toContain('d111.cloudfront.net');
  });

  it('gives an uncached 503 with the dependency failure', async () => {
    const { render } = build({
      caller: {
        course: { publicView: async () => Promise.reject(new Error('boom')) },
        review: { summary: async () => ({}), list: async () => ({}) },
      } as never,
    });
    const response = await render(get('/learn/c1'));
    expect(response.statusCode).toBe(503);
    expect(response.headers['Cache-Control']).toBe('no-store');
  });

  it('follows the template ETag, reusing it on 304 and failing on a failed read', async () => {
    const source = vi
      .fn()
      .mockResolvedValueOnce({ body: TEMPLATE, etag: 'e1' })
      .mockResolvedValueOnce({ notModified: true })
      .mockResolvedValueOnce({
        body: TEMPLATE.replace('a.js', 'b.js'),
        etag: 'e2',
      })
      .mockRejectedValueOnce(new Error('S3 down'));
    const { render } = build({ loadTemplate: createTemplateLoader(source) });
    expect((await render(get('/learn/c1'))).body).toContain('/assets/a.js');
    expect((await render(get('/learn/c1'))).body).toContain('/assets/a.js');
    expect((await render(get('/learn/c1'))).body).toContain('/assets/b.js');
    const failed = await render(get('/learn/c1'));
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain('b.js');
    expect(source).toHaveBeenNthCalledWith(2, 'e1');
    expect(source).toHaveBeenNthCalledWith(3, 'e1');
    expect(source).toHaveBeenNthCalledWith(4, 'e2');
  });

  it('sets X-Robots-Tag when indexing is off, and not when it is on', async () => {
    const off = await build({}, { allowIndexing: false }).render(
      get('/learn/c1'),
    );
    expect(off.headers['X-Robots-Tag']).toBe('noindex');
    expect(off.body).toContain('<meta name="robots" content="noindex" />');
    const on = await build().render(get('/learn/c1'));
    expect(on.headers['X-Robots-Tag']).toBeUndefined();
  });

  it('serves robots.txt and the sitemap', async () => {
    const { render } = build();
    const robots = await render(get('/robots.txt'));
    expect(robots.body).toContain(
      'Sitemap: https://learn.example.com/sitemap.xml',
    );
    const sitemap = await render(get('/sitemap.xml'));
    expect(sitemap.headers['Content-Type']).toContain('application/xml');
    expect(sitemap.body).toContain(
      '<loc>https://learn.example.com/learn/c1</loc>',
    );
    const closed = await build({}, { allowIndexing: false }).render(
      get('/robots.txt'),
    );
    expect(closed.body).toBe('User-agent: *\nDisallow: /\n');
  });

  it('answers 405 for other methods, and an empty body for HEAD', async () => {
    const { render } = build();
    expect((await render(get('/learn/c1', {}, 'POST'))).statusCode).toBe(405);
    const head = await render(get('/learn/c1', {}, 'HEAD'));
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe('');
  });

  it('never reads or sets cookies or Authorization', async () => {
    const { render, publicView } = build();
    const response = await render(
      get('/learn/c1', {
        cookie: 'session=secret',
        authorization: 'Bearer secret',
      }),
    );
    expect(JSON.stringify(response)).not.toContain('secret');
    expect(
      Object.keys(response.headers).map((key) => key.toLowerCase()),
    ).not.toContain('set-cookie');
    expect(publicView).toHaveBeenCalledWith({ courseId: 'c1' });
  });

  describe('certificates', () => {
    it('renders the head for one certificate, never indexed, even where indexing is on', async () => {
      const { render, verify } = build();
      const response = await render(
        get('/certificates/ABCD-EFGH-JKMN-PQRS', {
          'x-discava-host': 'learn.example.com',
        }),
      );
      expect(response.statusCode).toBe(200);
      expect(response.headers['X-Robots-Tag']).toBe('noindex');
      expect(response.headers['Cache-Control']).toBe(
        'public, max-age=0, s-maxage=300',
      );
      expect(response.body).toContain(
        '<meta name="robots" content="noindex" />',
      );
      expect(response.body).toContain(
        'Sam &lt;b&gt; &quot;Q&quot; &amp; Co completed Rust &amp; &quot;Go&quot; | Discava',
      );
      expect(response.body).not.toContain('<b>');
      expect(response.body).toContain('Certificate ID ABCD-EFGH-JKMN-PQRS.');
      expect(response.body).toContain('<div id="root"></div>');
      expect(verify).toHaveBeenCalledWith({
        certificateId: 'ABCD-EFGH-JKMN-PQRS',
      });
    });

    it('gives an ID without dashes the canonical display form', async () => {
      const { render } = build();
      const response = await render(get('/certificates/abcdefghjkmnpqrs'));
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain(
        'href="https://learn.example.com/certificates/ABCD-EFGH-JKMN-PQRS"',
      );
    });

    it('answers unknown and malformed IDs with the same 404 bytes', async () => {
      const { render } = build();
      const unknown = await render(get('/certificates/ZZZZ-ZZZZ-ZZZZ-ZZZZ'));
      const malformed = await render(get('/certificates/nope'));
      expect(unknown.statusCode).toBe(404);
      expect(unknown.headers['X-Robots-Tag']).toBe('noindex');
      expect(unknown.headers['Cache-Control']).toBe(
        'public, max-age=0, s-maxage=60',
      );
      expect(malformed).toEqual(unknown);
      expect(unknown.body).toContain('Not found');
    });

    it('answers an ID the procedure rejects as too long with the same 404', async () => {
      const { render } = build();
      const unknown = await render(get('/certificates/ZZZZ-ZZZZ-ZZZZ-ZZZZ'));
      const tooLong = await render(get(`/certificates/${'A'.repeat(101)}`));
      expect(tooLong.statusCode).toBe(404);
      expect(tooLong).toEqual(unknown);
    });

    it('gives the plain noindex template to deeper paths without a lookup', async () => {
      const { render, verify } = build();
      const response = await render(
        get('/certificates/ABCD-EFGH-JKMN-PQRS/linkedin'),
      );
      expect(response.statusCode).toBe(200);
      expect(response.headers['X-Robots-Tag']).toBe('noindex');
      expect(response.body).toContain(
        '<meta name="robots" content="noindex" />',
      );
      expect(response.body).not.toContain('og:title');
      expect(verify).not.toHaveBeenCalled();
    });

    it('answers a bare /certificates with 404', async () => {
      const { render } = build();
      expect((await render(get('/certificates'))).statusCode).toBe(404);
    });

    it('sends the headers without the body for HEAD', async () => {
      const { render } = build();
      const response = await render(
        get('/certificates/ABCD-EFGH-JKMN-PQRS', {}, 'HEAD'),
      );
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('');
      expect(response.headers['X-Robots-Tag']).toBe('noindex');
    });

    it('holds no user ID, course ID or email in the response', async () => {
      const { render } = build({
        caller: {
          certificate: {
            verify: async () => ({
              ...certificate,
              userId: 'user-123',
              courseId: 'course-456',
              email: 'sam@example.com',
            }),
          },
        },
      } as unknown as Partial<PageRendererDeps>);
      const { body } = await render(get('/certificates/ABCD-EFGH-JKMN-PQRS'));
      expect(body).not.toContain('user-123');
      expect(body).not.toContain('course-456');
      expect(body).not.toContain('sam@example.com');
    });

    it('answers 503 when the lookup fails', async () => {
      const { render } = build({
        caller: {
          certificate: {
            verify: async () => {
              throw new Error('table down');
            },
          },
        },
      } as unknown as Partial<PageRendererDeps>);
      const response = await render(get('/certificates/ABCD-EFGH-JKMN-PQRS'));
      expect(response.statusCode).toBe(503);
      expect(response.headers['Cache-Control']).toBe('no-store');
    });
  });
});
