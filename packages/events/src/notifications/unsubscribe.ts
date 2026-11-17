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
import middy from '@middy/core';
import type { Context } from 'aws-lambda';

export type { Context };

process.env.POWERTOOLS_METRICS_NAMESPACE = 'NotificationUnsubscribe';
process.env.POWERTOOLS_SERVICE_NAME = 'NotificationUnsubscribe';

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();

export const notificationUnsubscribe = async (event: any): Promise<any> => {
  logger.info('Received event', event);

  // TODO: implement
};

export const handler = middy()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .handler(notificationUnsubscribe);
