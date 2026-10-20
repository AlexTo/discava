/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Duration } from 'aws-cdk-lib';
import { type FunctionProps, Tracing } from 'aws-cdk-lib/aws-lambda';

/** Per-stage settings for the Lambda functions serving an API. */
export interface ApiFunctionOptions {
  /**
   * How long a request may run before Lambda stops it.
   *
   * @default the API's own default (30 seconds)
   */
  readonly timeout?: Duration;
  /**
   * How many requests each function handles at once. Requests beyond it are
   * rejected rather than scaled out to, which caps what a flood can cost.
   *
   * @default no reservation
   */
  readonly reservedConcurrentExecutions?: number;
  /**
   * The lowest level the functions log at (POWERTOOLS_LOG_LEVEL).
   *
   * @default Powertools' default, INFO
   */
  readonly logLevel?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  /**
   * Trace invocations with AWS X-Ray.
   *
   * @default true
   */
  readonly tracing?: boolean;
}

// The FunctionProps an API's functions take from `options`, on top of the
// API's defaults. Turning tracing off also tells Powertools' tracer, so it
// doesn't try to send segments.
export const apiFunctionProps = ({
  timeout,
  reservedConcurrentExecutions,
  logLevel,
  tracing = true,
}: ApiFunctionOptions = {}): Partial<FunctionProps> => ({
  ...(timeout && { timeout }),
  ...(reservedConcurrentExecutions !== undefined && {
    reservedConcurrentExecutions,
  }),
  tracing: tracing ? Tracing.ACTIVE : Tracing.DISABLED,
  environment: {
    ...(logLevel && { POWERTOOLS_LOG_LEVEL: logLevel }),
    ...(!tracing && { POWERTOOLS_TRACE_ENABLED: 'false' }),
  },
});
