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
import {
  handleUnsubscribe,
  type UnsubscribeDeps,
} from '@discava/common-server-utils/unsubscribe';
import { resolveUnsubscribeSecret } from '@discava/common-server-utils/unsubscribe-token';
import {
  createCoreTableService,
  NOTIFICATION_TYPES,
  setNotificationPreference,
} from '@discava/core-table';
import middy from '@middy/core';
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';

export type { Context };

process.env.POWERTOOLS_METRICS_NAMESPACE = 'NotificationUnsubscribe';
process.env.POWERTOOLS_SERVICE_NAME = 'NotificationUnsubscribe';

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

// The table is opened on the first write, so a malformed or forged token is
// refused before any table access.
const defaultDeps = async (): Promise<UnsubscribeDeps> => {
  const secret = await resolveUnsubscribeSecret();
  return {
    secret,
    setEmailEnabled: async (userId, type, enabled) =>
      setNotificationPreference(await getCoreTable(), userId, type, enabled),
    typeInfo: (type) =>
      Object.hasOwn(NOTIFICATION_TYPES, type)
        ? NOTIFICATION_TYPES[type]
        : undefined,
  };
};

// The student portal calls this route with fetch. A mail client's one-click
// POST is not a browser request, so CORS does not apply to it.
const corsHeaders = (): Record<string, string> => {
  const origin = process.env.STUDENT_PORTAL_URL?.replace(/\/+$/, '');
  return origin
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET,POST',
        Vary: 'Origin',
      }
    : {};
};

/** The API Gateway proxy handler for `GET`/`POST /unsubscribe/{token}`. */
export const notificationUnsubscribe = async (
  event: Pick<
    APIGatewayProxyEvent,
    'httpMethod' | 'pathParameters' | 'queryStringParameters' | 'body'
  > &
    Partial<Pick<APIGatewayProxyEvent, 'isBase64Encoded'>>,
  deps?: UnsubscribeDeps,
): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...corsHeaders(),
  };
  try {
    // The body is ignored (a JSON body or `List-Unsubscribe=One-Click`), but
    // it is decoded so the handler sees what was sent.
    const body =
      event.body && event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf-8')
        : event.body;
    const { status, body: result } = await handleUnsubscribe(
      {
        method: event.httpMethod,
        token: event.pathParameters?.token,
        query: event.queryStringParameters,
        body,
      },
      deps ?? (await defaultDeps()),
    );
    return { statusCode: status, headers, body: JSON.stringify(result) };
  } catch (error) {
    logger.error('Unsubscribe failed', error as Error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'internal' }),
    };
  }
};

export const handler = middy()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .handler((event: any) => notificationUnsubscribe(event));
