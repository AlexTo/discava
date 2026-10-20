/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  CoreApiComponentConfig,
  InstructorApiComponentConfig,
} from '@discava/common-infra-config';
import { Duration } from 'aws-cdk-lib';

// When a stage leaves a limit out, per method (API Gateway throttles each
// method separately). Well below AWS's own defaults (10,000 requests/s),
// which no stage of this app comes near.
const DEFAULT_THROTTLE = { rateLimit: 100, burstLimit: 200 };
const DEFAULT_PUBLIC_THROTTLE = { rateLimit: 20, burstLimit: 40 };

// An API's stage settings as its construct and defaultIntegrations take them:
// API Gateway throttling and tracing for the API, and timeout, reserved
// concurrency, log level and tracing for its functions.
export const apiLimits = (
  config: CoreApiComponentConfig | InstructorApiComponentConfig | undefined,
) => {
  const enableTracing = config?.enableTracing ?? true;
  return {
    enableTracing,
    throttle: {
      rateLimit: config?.throttleRateLimit ?? DEFAULT_THROTTLE.rateLimit,
      burstLimit: config?.throttleBurstLimit ?? DEFAULT_THROTTLE.burstLimit,
    },
    functionOptions: {
      ...(config?.timeoutSeconds !== undefined && {
        timeout: Duration.seconds(config.timeoutSeconds),
      }),
      reservedConcurrentExecutions: config?.reservedConcurrency,
      logLevel: config?.logLevel,
      tracing: enableTracing,
    },
  };
};

// The throttle for core-api's operations anyone may call without signing in.
export const publicThrottle = (config: CoreApiComponentConfig | undefined) => ({
  rateLimit:
    config?.publicThrottleRateLimit ?? DEFAULT_PUBLIC_THROTTLE.rateLimit,
  burstLimit:
    config?.publicThrottleBurstLimit ?? DEFAULT_PUBLIC_THROTTLE.burstLimit,
});
