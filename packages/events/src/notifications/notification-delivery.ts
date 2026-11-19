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
import { resolveUnsubscribeSecret } from '@discava/common-server-utils/unsubscribe-token';
import { createCoreTableService } from '@discava/core-table';
import middy from '@middy/core';
import type { z } from 'zod';
import { sqsToStreamRecords } from '../router/sqs-stream-records.js';
import { fanOutBroadcast } from './fan-out.js';
import { type EmailConfig, sendNotificationEmail } from './send-email.js';

process.env.POWERTOOLS_METRICS_NAMESPACE = 'NotificationDelivery';
process.env.POWERTOOLS_SERVICE_NAME = 'NotificationDelivery';

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();

// Memoized across invocations on a warm Lambda, as in the other handlers.
let coreTablePromise: ReturnType<typeof createCoreTableService> | undefined;
const getCoreTable = () => {
  if (!coreTablePromise) {
    coreTablePromise = createCoreTableService();
  }
  return coreTablePromise;
};

// Read on each call, not at import, so local dev can set them first.
const emailConfig = (): EmailConfig => ({
  fromAddress: process.env.NOTIFICATIONS_FROM_ADDRESS || undefined,
  portalUrls: {
    student: process.env.STUDENT_PORTAL_URL ?? '',
    instructor: process.env.INSTRUCTOR_PORTAL_URL ?? '',
    admin: process.env.ADMIN_PORTAL_URL ?? '',
  },
  coreApiUrl: process.env.CORE_API_URL ?? '',
  unsubscribeSecret: resolveUnsubscribeSecret,
});

type Event = z.infer<typeof DynamoDBStreamSchema>;
type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

// Handles a batch of stream records: a `notificationBroadcast` INSERT is
// fanned out to its course's students, and a `notification` INSERT has its
// email sent. Anything else (a MODIFY, another entity) is ignored.
//
// How it tolerates the router's at-least-once, unordered delivery, and so
// duplicate and reordered records and redelivered batches:
// - Duplicates: the email is claimed with a conditional patch on its state, so
//   a second delivery of the same notification, or of the same record, finds
//   it claimed or final and sends nothing; a notification's id comes from its
//   type and key, so a fan-out run twice creates each one once.
// - Order: the two entities are independent. A `notification` INSERT never
//   needs its broadcast's INSERT handled first, and the fan-out reads the
//   broadcast's current cursor and status, not the record's image, so a late
//   or repeated broadcast record resumes or does nothing.
// - Failure: a record that fails doesn't stop the others in the batch; the
//   batch then throws (SQS can't split it), the queue delivers it again, and
//   what was already done is absorbed by the points above.
export const notificationDelivery = async (
  coreTable: CoreTable,
  event: Event,
  config: EmailConfig = emailConfig(),
): Promise<{ handled: number; ignored: number }> => {
  let handled = 0;
  let ignored = 0;
  const failures: unknown[] = [];
  for (const record of event.Records) {
    const image: Record<string, unknown> | undefined =
      record.eventName === 'INSERT' ? record.dynamodb.NewImage : undefined;
    try {
      if (image?.__edb_e__ === 'notificationBroadcast') {
        await fanOutBroadcast(coreTable, image.id as string);
        handled++;
      } else if (image?.__edb_e__ === 'notification') {
        await sendNotificationEmail(
          coreTable,
          {
            userId: image.userId as string,
            occurredAt: image.occurredAt as string,
            id: image.id as string,
          },
          config,
        );
        handled++;
      } else {
        ignored++;
      }
    } catch (error) {
      logger.error('Failed to handle a notification record', { error });
      failures.push(error);
    }
  }
  logger.info('Handled notification records', {
    records: event.Records.length,
    handled,
    ignored,
    failed: failures.length,
  });
  metrics.addMetric('RecordsHandled', MetricUnit.Count, handled);
  if (failures.length > 0) {
    throw failures[0];
  }
  return { handled, ignored };
};

export const handler = middy()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .use(sqsToStreamRecords())
  .use(parser({ schema: DynamoDBStreamSchema }))
  .handler(async (event) => {
    await notificationDelivery(await getCoreTable(), event);
  });
