/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { CreateAWSLambdaContextOptions } from '@trpc/server/adapters/aws-lambda';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { IAuthContext } from './auth.js';
import { ICoreTableContext } from './core-table.js';
import { ILoggerContext } from './logger.js';
import { IMetricsContext } from './metrics.js';
import { ITracerContext } from './tracer.js';

export * from './auth.js';
export * from './core-table.js';
export * from './error.js';
export * from './logger.js';
export * from './metrics.js';
export * from './tracer.js';

export interface IResponseCookiesContext {
  /**
   * Set-Cookie values a procedure wants on the response, emitted by the
   * handler's responseMeta. Kept out of procedure output so values meant to
   * be HttpOnly never reach the client's JS.
   */
  responseCookies?: string[];
}

export type IMiddlewareContext =
  CreateAWSLambdaContextOptions<APIGatewayProxyEvent> &
    IAuthContext &
    ICoreTableContext &
    ILoggerContext &
    IMetricsContext &
    ITracerContext &
    IResponseCookiesContext;
