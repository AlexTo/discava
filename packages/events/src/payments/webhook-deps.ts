/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Logger } from '@aws-lambda-powertools/logger';
import type { LogAttributes } from '@aws-lambda-powertools/logger/types';
import { withStripe } from '@discava/common-server-utils/stripe/client';
import { createCoreTableService } from '@discava/core-table';
import type Stripe from 'stripe';

export interface WebhookLogger {
  info: (message: string, data?: LogAttributes) => void;
  warn: (message: string, data?: LogAttributes) => void;
  error: (message: string, data?: LogAttributes) => void;
}

/** What the webhook touches, so a test can stand in for each. */
export interface WebhookDeps {
  getCoreTable: () => ReturnType<typeof createCoreTableService>;
  withStripe: <T>(call: (stripe: Stripe) => Promise<T>) => Promise<T>;
  now: () => string;
  logger: WebhookLogger;
}

// Memoized across invocations on a warm Lambda, as in the other handlers.
let coreTablePromise: ReturnType<typeof createCoreTableService> | undefined;

let cachedDeps: WebhookDeps | undefined;
export const defaultWebhookDeps = (): WebhookDeps =>
  (cachedDeps ??= buildDeps());

const buildDeps = (): WebhookDeps => ({
  getCoreTable: () => {
    coreTablePromise ??= createCoreTableService();
    return coreTablePromise;
  },
  withStripe,
  now: () => new Date().toISOString(),
  logger: (() => {
    const logger = new Logger({ serviceName: 'StripeWebhook' });
    return {
      info: (message, data = {}) => logger.info(message, data),
      warn: (message, data = {}) => logger.warn(message, data),
      error: (message, data = {}) => logger.error(message, data),
    };
  })(),
});
