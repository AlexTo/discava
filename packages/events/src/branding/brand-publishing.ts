/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { logMetrics } from '@aws-lambda-powertools/metrics/middleware';
import { parser } from '@aws-lambda-powertools/parser/middleware';
import { DynamoDBStreamSchema } from '@aws-lambda-powertools/parser/schemas';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { BrandDocumentSchema } from '@discava/common-branding/brand';
import {
  getS3Client,
  resolveBucketName,
} from '@discava/common-server-utils/lesson-media-bucket';
import {
  createCoreTableService,
  getBrand,
  type PlatformBrandRecord,
} from '@discava/core-table';
import middy from '@middy/core';
import { sqsToStreamRecords } from '../router/sqs-stream-records.js';

process.env.POWERTOOLS_METRICS_NAMESPACE = 'BrandPublishing';
process.env.POWERTOOLS_SERVICE_NAME = 'BrandPublishing';

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();

/** Where the portals and the page renderer read the published brand. */
export const BRAND_DOCUMENT_KEY = 'brand/brand.json';

// A minute in the browser, four in the CDN: a change reaches visitors within
// five minutes (research R-3).
export const BRAND_DOCUMENT_CACHE_CONTROL = 'public, max-age=60, s-maxage=240';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

// Memoized across invocations on a warm Lambda, as in the other handlers.
let coreTablePromise: ReturnType<typeof createCoreTableService> | undefined;
const getCoreTable = () => {
  if (!coreTablePromise) {
    coreTablePromise = createCoreTableService();
  }
  return coreTablePromise;
};

export interface BrandPublishingDeps {
  /** The current brand record, or undefined before the first save. */
  readCurrent: () => Promise<PlatformBrandRecord | undefined>;
  /** Writes `brand/brand.json`. */
  put: (input: {
    key: string;
    body: string;
    contentType: string;
    cacheControl: string;
  }) => Promise<void>;
}

/**
 * Publishes the brand to `brand/brand.json`. However many records the batch
 * holds, it reads the record as it now stands (never a stream image, which
 * may be older than another record's in the same batch) and writes that, so
 * publishing is idempotent and the last write is always the latest brand.
 * The document is the public projection: `BrandDocumentSchema` leaves out who
 * saved and when.
 */
export const brandPublishing = async (
  deps: BrandPublishingDeps,
  records: number,
): Promise<{ published: boolean }> => {
  const current = await deps.readCurrent();
  if (!current) {
    logger.warn('Brand records changed but no brand record exists', {
      records,
    });
    return { published: false };
  }
  const document = BrandDocumentSchema.parse(current);
  await deps.put({
    key: BRAND_DOCUMENT_KEY,
    body: JSON.stringify(document),
    contentType: 'application/json',
    cacheControl: BRAND_DOCUMENT_CACHE_CONTROL,
  });
  logger.info('Published the brand', {
    records,
    revision: document.revision,
  });
  metrics.addMetric('BrandPublished', MetricUnit.Count, 1);
  return { published: true };
};

const coreTableDeps = (coreTable: CoreTable): BrandPublishingDeps => ({
  readCurrent: () => getBrand(coreTable),
  put: async ({ key, body, contentType, cacheControl }) => {
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: await resolveBucketName('PublicMediaBucket'),
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
      }),
    );
  },
});

export const handler = middy()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .use(sqsToStreamRecords())
  .use(parser({ schema: DynamoDBStreamSchema }))
  .handler(async (event) => {
    await brandPublishing(
      coreTableDeps(await getCoreTable()),
      event.Records.length,
    );
  });
