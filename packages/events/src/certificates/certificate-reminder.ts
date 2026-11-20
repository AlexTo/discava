/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { logMetrics } from '@aws-lambda-powertools/metrics/middleware';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import {
  claimCertificateReminder,
  createCoreTableService,
  formatCertificateId,
  isEmailEnabled,
  publishNotification,
} from '@discava/core-table';
import middy from '@middy/core';
import type { Context } from 'aws-lambda';
import { z } from 'zod';

export type { Context };

process.env.POWERTOOLS_METRICS_NAMESPACE = 'CertificateReminder';
process.env.POWERTOOLS_SERVICE_NAME = 'CertificateReminder';

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();

const ReminderEventSchema = z.object({
  userId: z.string().min(1),
  courseId: z.string().min(1),
});

let coreTablePromise: ReturnType<typeof createCoreTableService> | undefined;

// Invoked asynchronously by the one-time schedule that recalculate.ts creates
// when a certificate is issued, and by the local event runner. Three steps:
// the user's "Certificates" email setting, the claim (which a recorded LinkedIn
// click beats), and the notification, which the delivery feature emails. Each
// step is safe to repeat, so a retry or a duplicate delivery still leaves one
// reminder; errors propagate so Lambda's async retries take over.
export const certificateReminder = async (event: unknown): Promise<void> => {
  logger.info('Received event', event as Record<string, unknown>);

  const parsed = ReminderEventSchema.safeParse(event);
  if (!parsed.success) {
    logger.error('Dropping a malformed event', { issues: parsed.error.issues });
    return;
  }
  const { userId, courseId } = parsed.data;

  coreTablePromise ??= createCoreTableService();
  const coreTable = await coreTablePromise;

  if (!(await isEmailEnabled(coreTable, userId, 'certificate.reminder'))) {
    logger.info('Certificate emails are off; no reminder', { userId });
    return;
  }

  const claimed = await claimCertificateReminder({
    coreTable,
    userId,
    courseId,
    now: new Date(),
  });
  if (!claimed) {
    logger.info('No certificate, or it was added to LinkedIn; no reminder', {
      userId,
      courseId,
    });
    return;
  }
  const { certificate, reminderSentAt } = claimed;

  const result = await publishNotification(coreTable, {
    type: 'certificate.reminder',
    userId,
    params: {
      certificateId: formatCertificateId(certificate.certificateId),
      courseTitle: certificate.courseTitle,
    },
    dedupeKey: certificate.certificateId,
    occurredAt: reminderSentAt,
  });
  if (result === 'created') {
    metrics.addMetric('RemindersSent', MetricUnit.Count, 1);
  }
};

export const handler = middy()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .handler(certificateReminder);
