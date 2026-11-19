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
import {
  createCoreTableService,
  EARNINGS_STREAM_FILTERS,
  recordRefund,
  recordSale,
} from '@discava/core-table';
import middy from '@middy/core';
import type { z } from 'zod';
import { sqsToStreamRecords } from '../router/sqs-stream-records.js';
import {
  isSale,
  type OrderImage,
  refundInput,
  saleInput,
} from './earnings-from-order.js';

process.env.POWERTOOLS_METRICS_NAMESPACE = 'EarningsRecording';
process.env.POWERTOOLS_SERVICE_NAME = 'EarningsRecording';

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

// Memoized across invocations on a warm Lambda, as in the other handlers.
let coreTablePromise: ReturnType<typeof createCoreTableService> | undefined;
const getCoreTable = () => {
  if (!coreTablePromise) {
    coreTablePromise = createCoreTableService();
  }
  return coreTablePromise;
};

export interface EarningsSettings {
  feeBasisPoints: number;
  holdDays: number;
}

const integerFrom = (name: string, max = Number.MAX_SAFE_INTEGER): number => {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? Number.NaN : Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(
      `${name} must be a non-negative integer${max < Number.MAX_SAFE_INTEGER ? ` up to ${max}` : ''}, got ${String(raw)}`,
    );
  }
  return value;
};

/** The stage's fee and hold, read from the environment (throws if missing or invalid). */
export const readEarningsSettings = (): EarningsSettings => ({
  feeBasisPoints: integerFrom('PLATFORM_FEE_BASIS_POINTS', 10000),
  holdDays: integerFrom('PAYOUT_HOLD_DAYS'),
});

export interface EarningsWrites {
  instructorIds: (courseId: string) => Promise<string[]>;
  recordSale: (
    input: ReturnType<typeof saleInput> & {
      instructorIds: string[];
      feeBasisPoints: number;
      holdDays: number;
    },
  ) => Promise<boolean>;
  recordRefund: (input: {
    orderId: string;
    refundedTotal: number;
    occurredAt: string;
  }) => Promise<boolean>;
}

const isOrderChange = (record: {
  eventName?: string;
  dynamodb: { NewImage?: Record<string, unknown> };
}): boolean =>
  EARNINGS_STREAM_FILTERS.some(
    ({ eventName, image, entities }) =>
      image === 'NewImage' &&
      record.eventName === eventName &&
      entities.includes(String(record.dynamodb.NewImage?.__edb_e__ ?? '')),
  );

// Records the instructors' earnings from the order records the router sends:
// a sale once, and each rise of its refunded total once.
//
// How it tolerates the router's at-least-once, unordered delivery, and so
// duplicate and reordered records and redelivered batches: every image of a
// sale carries all it needs, so any one image is enough to record the sale
// and to bring its refunded total up to date.
// - Duplicates: a recorded sale is a no-op (its entries are created on the
//   condition that they do not exist), and so is a refunded total the ledger
//   has already reached.
// - Order: an older image delivered after a newer one finds a higher
//   `refundedMinor` and records nothing; a newer one delivered first records
//   the sale and the whole refunded total, and the older one is then a no-op.
//   No record waits for another, so nothing relies on redelivery for order.
//   Two refunds seen out of order may be recorded as one entry dated by the
//   later one; the total always catches up.
// - Failure: every record that can be applied is, then the batch throws, so
//   the queue delivers it again and what was applied changes nothing.
export const earningsRecording = async (
  event: z.infer<typeof DynamoDBStreamSchema>,
  writes: EarningsWrites,
  { feeBasisPoints, holdDays }: EarningsSettings,
): Promise<{ sales: number; refunds: number; skipped: number }> => {
  let sales = 0;
  let refunds = 0;
  let skipped = 0;
  const failures: unknown[] = [];
  for (const record of event.Records) {
    const order = record.dynamodb.NewImage as OrderImage | undefined;
    if (!order || !isOrderChange(record) || !isSale(order)) {
      skipped++;
      continue;
    }
    try {
      const sale = saleInput(order);
      const instructorIds = await writes.instructorIds(sale.courseId);
      if (instructorIds.length === 0) {
        logger.error('Course has no instructor; no earnings recorded', {
          orderId: sale.orderId,
          courseId: sale.courseId,
        });
        skipped++;
        continue;
      }
      if (
        await writes.recordSale({
          ...sale,
          instructorIds,
          feeBasisPoints,
          holdDays,
        })
      ) {
        sales++;
      }
      const refund = refundInput(order);
      if (refund && (await writes.recordRefund(refund))) {
        refunds++;
      }
    } catch (error) {
      failures.push(error);
    }
  }

  logger.info('Recorded earnings', {
    records: event.Records.length,
    sales,
    refunds,
    skipped,
    failed: failures.length,
  });
  metrics.addMetric('SalesRecorded', MetricUnit.Count, sales);
  metrics.addMetric('RefundsRecorded', MetricUnit.Count, refunds);
  if (failures.length > 0) {
    throw failures[0];
  }
  return { sales, refunds, skipped };
};

const coreTableWrites = (coreTable: CoreTable): EarningsWrites => ({
  instructorIds: async (courseId) =>
    (
      await coreTable.entities.courseInstructor.query
        .primary({ courseId })
        .go({ pages: 'all' })
    ).data.map((instructor) => instructor.instructorId),
  recordSale: ({ instructorIds, feeBasisPoints, holdDays, ...order }) =>
    recordSale({ coreTable, order, instructorIds, feeBasisPoints, holdDays }),
  recordRefund: (input) => recordRefund({ coreTable, ...input }),
});

let settings: EarningsSettings | undefined;

export const handler = middy()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .use(sqsToStreamRecords())
  .use(parser({ schema: DynamoDBStreamSchema }))
  .handler(async (event) => {
    settings ??= readEarningsSettings();
    await earningsRecording(
      event,
      coreTableWrites(await getCoreTable()),
      settings,
    );
  });
