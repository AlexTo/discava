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
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';
import { handleStripeWebhook } from './stripe-webhook.js';

export type { Context };

process.env.POWERTOOLS_METRICS_NAMESPACE = 'StripeWebhook';
process.env.POWERTOOLS_SERVICE_NAME = 'StripeWebhook';

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();

type WebhookEvent = Pick<APIGatewayProxyEvent, 'headers' | 'body'> &
  Partial<Pick<APIGatewayProxyEvent, 'isBase64Encoded'>>;

// Header names reach a Lambda proxy in whatever case the sender used.
const headerOf = (
  headers: WebhookEvent['headers'] | null | undefined,
  name: string,
) => {
  const wanted = name.toLowerCase();
  return Object.entries(headers ?? {}).find(
    ([key]) => key.toLowerCase() === wanted,
  )?.[1];
};

/**
 * The API Gateway proxy handler for `POST /stripe/webhook`. Passes Stripe's
 * exact bytes (base64-decoded when API Gateway encoded them) and signature
 * header on, and answers with the status alone.
 */
export const stripeWebhook = async (
  event: WebhookEvent,
  handle: typeof handleStripeWebhook = handleStripeWebhook,
): Promise<APIGatewayProxyResult> => {
  const rawBody = Buffer.from(
    event.body ?? '',
    event.isBase64Encoded ? 'base64' : 'utf-8',
  );
  const { status } = await handle(
    rawBody,
    headerOf(event.headers, 'stripe-signature'),
  );
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: status === 200 ? JSON.stringify({ received: true }) : '',
  };
};

export const handler = middy()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .handler((event: any) => stripeWebhook(event));
