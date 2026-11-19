/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { Metrics } from '@aws-lambda-powertools/metrics';
import { logMetrics } from '@aws-lambda-powertools/metrics/middleware';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import {
  getS3Client,
  resolveAppConfigValue,
} from '@discava/common-server-utils/lesson-media-bucket';
import {
  isLocalDev,
  LOCAL_PORTAL_URLS,
  localObjectUrl,
} from '@discava/common-server-utils/local-dev';
import { type CoreTable, createCoreTableService } from '@discava/core-table';
import middy from '@middy/core';
import { TRPCError } from '@trpc/server';
import { sitemapEntries } from '../helpers/sitemap.js';
import { appRouter } from '../router.js';
import { escapeHtml, injectIntoTemplate } from './html.js';
import {
  notFoundHead,
  originOf,
  type PageContext,
  type RenderedPage,
} from './page.js';
import { renderCoursePage } from './render-course.js';
import { renderProfilePage } from './render-profile.js';
import { robotsTxt } from './robots.js';
import { createTemplateLoader, type TemplateSource } from './template.js';

process.env.POWERTOOLS_METRICS_NAMESPACE = 'PageRenderer';
process.env.POWERTOOLS_SERVICE_NAME = 'PageRenderer';

/** The part of a Lambda Function URL event the renderer reads. */
export interface PageRendererEvent {
  rawPath: string;
  headers?: Record<string, string | undefined>;
  requestContext: { http: { method: string } };
}

/** The response the renderer returns: a Function URL result with every part set. */
export interface PageResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

type Caller = ReturnType<typeof appRouter.createCaller>;

export interface PageRendererDeps {
  loadTemplate: () => Promise<string>;
  caller: Caller;
  coreTable: () => Promise<CoreTable>;
  /** The public media bucket's base URL, ending in `/`; undefined when unknown. */
  mediaBaseUrl: () => Promise<string | undefined>;
  config: {
    allowIndexing: boolean;
    siteName: string;
    /** Hosts a response may name; empty allows any `*.cloudfront.net`. */
    allowedHosts: string[];
    /** The host used when the request names none that is allowed. */
    fallbackHost: string;
  };
  logger?: Pick<Logger, 'error'>;
}

const HTML = 'text/html; charset=utf-8';
const PAGE_CACHE = 'public, max-age=0, s-maxage=300';
const NOT_FOUND_CACHE = 'public, max-age=0, s-maxage=60';
const TEXT_CACHE = 'public, max-age=300, s-maxage=300';

// No cookies and no Authorization: the cache policy forwards neither, and the
// caller below carries no token, so a response never depends on who asks.
const anonymousContext = () =>
  ({
    event: { requestContext: { authorizer: { claims: undefined } } },
    context: {},
    info: {},
    responseCookies: [] as string[],
  }) as unknown as Parameters<typeof appRouter.createCaller>[0];

export const createAnonymousCaller = (): Caller =>
  appRouter.createCaller(anonymousContext());

const isNotFound = (error: unknown): boolean =>
  error instanceof TRPCError && error.code === 'NOT_FOUND';

const decode = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

const chooseHost = (
  requested: string | undefined,
  { allowedHosts, fallbackHost }: PageRendererDeps['config'],
): string => {
  const host = requested?.trim().toLowerCase();
  if (host) {
    if (allowedHosts.length > 0) {
      if (allowedHosts.some((allowed) => allowed.toLowerCase() === host)) {
        return host;
      }
    } else if (/^[a-z0-9-]+\.cloudfront\.net$/.test(host)) {
      return host;
    }
  }
  return allowedHosts[0] ?? fallbackHost;
};

export const createPageRenderer = (deps: PageRendererDeps) => {
  const { config } = deps;

  return async (event: PageRendererEvent): Promise<PageResponse> => {
    const method = event.requestContext.http.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      return {
        statusCode: 405,
        headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' },
        body: '',
      };
    }
    const respond = (result: PageResponse): PageResponse =>
      method === 'HEAD' ? { ...result, body: '' } : result;

    const path = event.rawPath || '/';
    const segments = path.split('/').filter(Boolean).map(decode);
    const noindex: Record<string, string> = config.allowIndexing
      ? {}
      : { 'X-Robots-Tag': 'noindex' };

    try {
      const host = chooseHost(event.headers?.['x-discava-host'], config);

      if (segments.length === 1 && segments[0] === 'robots.txt') {
        return respond({
          statusCode: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': TEXT_CACHE,
          },
          body: robotsTxt(host, config.allowIndexing),
        });
      }
      if (segments.length === 1 && segments[0] === 'sitemap.xml') {
        const entries = await sitemapEntries(await deps.coreTable());
        const origin = originOf(host);
        const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries
          .map(
            ({ path: entryPath, lastmod }) =>
              `<url><loc>${escapeHtml(origin + entryPath)}</loc><lastmod>${escapeHtml(lastmod)}</lastmod></url>`,
          )
          .join('\n')}\n</urlset>\n`;
        return respond({
          statusCode: 200,
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': TEXT_CACHE,
          },
          body,
        });
      }

      const mediaBase = await deps.mediaBaseUrl().catch((error) => {
        deps.logger?.error('Public media base URL unavailable', { error });
        return undefined;
      });
      const context: PageContext = {
        host,
        siteName: config.siteName,
        allowIndexing: config.allowIndexing,
        mediaUrl: (key) =>
          key && mediaBase ? new URL(key, mediaBase).toString() : undefined,
        defaultImageUrl: `${originOf(host)}/og-default.png`,
      };
      const template = await deps.loadTemplate();
      const html = (
        statusCode: number,
        page: string,
        cache: string,
        headers = noindex,
      ) =>
        respond({
          statusCode,
          headers: { 'Content-Type': HTML, 'Cache-Control': cache, ...headers },
          body: page,
        });
      const render = (page: RenderedPage) =>
        html(200, injectIntoTemplate(template, page), PAGE_CACHE);
      const notFound = () =>
        html(
          404,
          injectIntoTemplate(template, {
            head: notFoundHead(context),
            root: '',
          }),
          NOT_FOUND_CACHE,
          { 'X-Robots-Tag': 'noindex' },
        );

      const [first, id, ...rest] = segments;
      if (first === 'learn') {
        if (!id || rest.length > 0) {
          // The learning routes: signed-in, never indexed.
          return html(
            200,
            injectIntoTemplate(template, {
              head: `<title>${escapeHtml(config.siteName)}</title>\n<meta name="robots" content="noindex" />`,
              root: '',
            }),
            PAGE_CACHE,
            { 'X-Robots-Tag': 'noindex' },
          );
        }
        try {
          const [course, summary, reviews] = await Promise.all([
            deps.caller.course.publicView({ courseId: id }),
            deps.caller.review.summary({ courseId: id }),
            deps.caller.review.list({ courseId: id, limit: 10 }),
          ]);
          return render(
            renderCoursePage(context, { course, summary, reviews }),
          );
        } catch (error) {
          if (isNotFound(error)) return notFound();
          throw error;
        }
      }
      if (first === 'instructors' && id && rest.length === 0) {
        try {
          const profile = await deps.caller.instructorProfile.publicView({
            handle: id,
          });
          return render(renderProfilePage(context, profile));
        } catch (error) {
          if (isNotFound(error)) return notFound();
          throw error;
        }
      }
      return notFound();
    } catch (error) {
      // A dependency failed (table, AppConfig, template): never cached, never a 404.
      deps.logger?.error('Page render failed', { path, error });
      return respond({
        statusCode: 503,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex',
          'Retry-After': '5',
        },
        body: 'Service temporarily unavailable',
      });
    }
  };
};

// --- Deployed wiring ---

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();

const s3TemplateSource =
  (bucket: string): TemplateSource =>
  async (etag) => {
    try {
      const response = await getS3Client().send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: 'index.html',
          ...(etag && { IfNoneMatch: etag }),
        }),
      );
      return {
        body: (await response.Body?.transformToString('utf-8')) ?? '',
        etag: response.ETag,
      };
    } catch (error) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 304
      ) {
        return { notModified: true };
      }
      throw error;
    }
  };

/** Local dev's template: the student portal's dev server. */
export const httpTemplateSource =
  (url: string): TemplateSource =>
  async (etag) => {
    const response = await fetch(url, {
      headers: etag ? { 'If-None-Match': etag } : {},
    });
    if (response.status === 304) return { notModified: true };
    if (!response.ok) {
      throw new Error(`Template request failed: ${response.status}`);
    }
    return {
      body: await response.text(),
      etag: response.headers.get('etag') ?? undefined,
    };
  };

let coreTablePromise: Promise<CoreTable> | undefined;
const readCoreTable = () => {
  coreTablePromise ??= createCoreTableService();
  return coreTablePromise;
};

const readMediaBaseUrl = async (): Promise<string | undefined> => {
  if (isLocalDev()) return localObjectUrl('PublicMediaBucket', '');
  const { cloudFrontDomainName } = await resolveAppConfigValue<{
    cloudFrontDomainName: string;
  }>('s3', 'PublicMediaBucket');
  return `https://${cloudFrontDomainName}/`;
};

/** The renderer as configured by its environment, for the Lambda and the local server. */
export const createConfiguredPageRenderer = () => {
  const templateUrl = LOCAL_PORTAL_URLS.student;
  return createPageRenderer({
    loadTemplate: createTemplateLoader(
      isLocalDev()
        ? httpTemplateSource(templateUrl)
        : s3TemplateSource(process.env.WEBSITE_BUCKET ?? ''),
    ),
    caller: createAnonymousCaller(),
    coreTable: readCoreTable,
    mediaBaseUrl: readMediaBaseUrl,
    config: {
      allowIndexing: process.env.ALLOW_SEARCH_ENGINE_INDEXING === 'true',
      siteName: process.env.SITE_NAME || 'Discava',
      allowedHosts: (process.env.ALLOWED_HOSTS ?? '')
        .split(',')
        .map((host) => host.trim())
        .filter(Boolean),
      fallbackHost: isLocalDev() ? new URL(templateUrl).host : 'localhost',
    },
    logger,
  });
};

let renderer: ReturnType<typeof createConfiguredPageRenderer> | undefined;

export const pageRenderer = (
  event: PageRendererEvent,
): Promise<PageResponse> => {
  renderer ??= createConfiguredPageRenderer();
  return renderer(event);
};

export const handler = middy<PageRendererEvent>()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .handler(pageRenderer);
