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
  createUserEntity,
  syncUserProfile,
  userProfileFrom,
} from '@discava/core-table';
import middy from '@middy/core';
import type { Context, PreTokenGenerationTriggerEvent } from 'aws-lambda';

export type { Context };

process.env.POWERTOOLS_METRICS_NAMESPACE = 'PreTokenGeneration';
process.env.POWERTOOLS_SERVICE_NAME = 'PreTokenGeneration';

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();

// Cognito fails the sign-in when a trigger throws or takes more than 5
// seconds, so the sync gives up well before that, AppConfig lookup included.
export const SYNC_BUDGET_MS = 3000;

// Memoized across invocations on a warm Lambda; forgotten if it failed (e.g.
// the table name isn't in AppConfig yet on a new stage), so the next sign-in
// tries again.
let userEntity: ReturnType<typeof createUserEntity> | undefined;

const getUserEntity = () => {
  if (!userEntity) {
    userEntity = createUserEntity().catch((error) => {
      userEntity = undefined;
      throw error;
    });
  }
  return userEntity;
};

const withinBudget = <T>(work: Promise<T>): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Took longer than ${SYNC_BUDGET_MS}ms`)),
      SYNC_BUDGET_MS,
    );
  });
  // Still settles after a timeout; nothing's waiting for it by then.
  work.catch(() => {});
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
};

// Keeps the user's core table record in step with Cognito (#230). Cognito runs
// this before issuing tokens on every sign-in, including an admin-created
// user's first one, and on every token refresh, so every user gets a record
// however they were created, and a changed name reaches it within the hour.
// The tokens themselves are left as they are. Best-effort: a failed or slow
// write is logged and the user still signs in.
/**
 * Syncs the profile from a pre-token-generation event. Local dev uses the
 * result to avoid caching a failed sync; the deployed trigger still treats
 * failure as best-effort and returns the original event.
 */
export const syncUserFromPreTokenGenerationEvent = async (
  event: PreTokenGenerationTriggerEvent,
): Promise<boolean> => {
  const profile = userProfileFrom(event.request.userAttributes);
  if (!profile) {
    logger.warn('No sub in the user attributes; no user record to sync', {
      triggerSource: event.triggerSource,
    });
    return true;
  }

  try {
    const outcome = await withinBudget(
      getUserEntity().then((user) => syncUserProfile(user, profile)),
    );
    logger.info('Synced the user record', {
      userId: profile.userId,
      outcome,
      triggerSource: event.triggerSource,
    });
    return true;
  } catch (error) {
    logger.error('Could not sync the user record; signing in anyway', {
      userId: profile.userId,
      error,
    });
    return false;
  }
};

export const preTokenGeneration = async (
  event: PreTokenGenerationTriggerEvent,
): Promise<PreTokenGenerationTriggerEvent> => {
  await syncUserFromPreTokenGenerationEvent(event);
  return event;
};

export const handler = middy<PreTokenGenerationTriggerEvent>()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .handler(preTokenGeneration);
