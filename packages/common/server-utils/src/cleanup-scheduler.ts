/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import type { Logger } from '@aws-lambda-powertools/logger';
import {
  ConflictException,
  CreateScheduleCommand,
  SchedulerClient,
} from '@aws-sdk/client-scheduler';
import { resolveAppConfigValue } from './lesson-media-bucket.js';
import {
  callLocalEventRunner,
  isLocalDev,
  type LocalScheduleRequest,
} from './local-dev.js';

// The one scheduler of the transcode-cleanup Lambda, used by instructor-api (a
// canceled job's own output, a video replaced or deleted, a file item's
// folder), core-api (a student's submission folders) and the event handlers.
// It lives here so every caller shares one implementation of the schedule's
// name, its time and the local-runner call.
let _schedulerClient: SchedulerClient | undefined;

const getSchedulerClient = (): SchedulerClient => {
  if (!_schedulerClient) {
    _schedulerClient = new SchedulerClient({});
  }
  return _schedulerClient;
};

type TranscodeCleanupConfig = {
  lambdaArn: string;
  schedulerRoleArn: string;
  scheduleGroupName: string;
};

// Published once by the media pipeline alongside the transcode-cleanup
// Lambda itself.
const resolveTranscodeCleanupConfig = (): Promise<TranscodeCleanupConfig> =>
  resolveAppConfigValue<TranscodeCleanupConfig>(
    'mediaConvert',
    'TranscodeCleanup',
  );

// How long to wait before deleting a job's own S3 output. For a canceled
// job specifically, this also has to be long enough to clear MediaConvert's
// async write tail -- direct testing observed writes continuing for ~30s
// after CancelJob -- and once destinations are nonce-scoped, a longer
// delay costs nothing there (nothing else will ever reference that prefix
// again). For an already-`ready` video being superseded or removed, there's
// no write-tail concern at all (it's long since finished transcoding) --
// the delay here is purely to keep the caller's own response fast, by
// moving a potentially-large paginated list+delete off the request path
// entirely; the same delay is reused for both rather than introducing a
// second constant needing its own justification.
const TRANSCODE_CLEANUP_DELAY_MINUTES = 10;

export interface TranscodeCleanupParams {
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
  submissionNonce: string;
}

export interface TranscodeCleanupOptions {
  /**
   * A user id: the cleanup then deletes nothing when that user's submission
   * for the item holds its current file in the folder.
   */
  keepIfCurrentFor?: string;
  /**
   * Why the folder is being cleaned up (`attempt`: a submit request's own
   * guard; `retire`: a replaced file). It goes into the schedule's name, so
   * two schedules for one folder don't collide, and into the payload.
   */
  purpose?: 'attempt' | 'retire';
  /** How long the local event runner waits, instead of its default. */
  localDelaySeconds?: number;
}

// Creates the schedule, throwing on any failure (an existing schedule of the
// same name included).
const createCleanupSchedule = async (
  params: TranscodeCleanupParams,
  delayMinutes: number,
  { keepIfCurrentFor, purpose, localDelaySeconds }: TranscodeCleanupOptions,
): Promise<void> => {
  const payload: Record<string, string> = {
    ...params,
    ...(keepIfCurrentFor !== undefined && { keepIfCurrentFor }),
    ...(purpose !== undefined && { purpose }),
  };

  // Local dev's event runner runs it after a short delay instead (#137).
  if (isLocalDev()) {
    await callLocalEventRunner('POST', '/schedules/transcode-cleanup', {
      payload,
      ...(localDelaySeconds !== undefined && {
        delaySeconds: localDelaySeconds,
      }),
    } satisfies LocalScheduleRequest);
    return;
  }
  const { lambdaArn, schedulerRoleArn, scheduleGroupName } =
    await resolveTranscodeCleanupConfig();

  // Schedule names cap out at 64 characters; a hash of the ids that actually
  // identify this folder (and why it's being cleaned up, when that's given)
  // keeps this well within that regardless of their length, and needs no
  // other uniqueness -- the identifying detail lives in the target's Input,
  // not the name.
  const scheduleName = `cleanup-${createHash('sha256')
    .update(
      `${params.contentItemId}:${params.submissionNonce}${purpose === undefined ? '' : `:${purpose}`}`,
    )
    .digest('hex')
    .slice(0, 32)}`;

  // EventBridge Scheduler's at() expression takes a literal local
  // timestamp with no timezone suffix or fractional seconds.
  const runAt = new Date(Date.now() + delayMinutes * 60_000)
    .toISOString()
    .slice(0, 19);

  await getSchedulerClient().send(
    new CreateScheduleCommand({
      Name: scheduleName,
      GroupName: scheduleGroupName,
      ScheduleExpression: `at(${runAt})`,
      FlexibleTimeWindow: { Mode: 'OFF' },
      // The schedule has done its job once it's fired once; nothing
      // reuses a specific folder's cleanup schedule, so there's no reason
      // to let it linger.
      ActionAfterCompletion: 'DELETE',
      Target: {
        Arn: lambdaArn,
        RoleArn: schedulerRoleArn,
        Input: JSON.stringify(payload),
      },
    }),
  );
};

/**
 * Schedules a one-time cleanup of a single job's own nonce-scoped S3
 * output, via an EventBridge Scheduler schedule that invokes
 * transcode-cleanup.ts a few minutes from now. Best-effort: a failure to
 * schedule just means that output isn't automatically cleaned up, not
 * that the caller's own action (canceling a job, replacing or deleting a
 * ready video) is undone.
 */
export const scheduleTranscodeCleanup = async (
  logger: Logger | undefined,
  params: TranscodeCleanupParams,
  // By default long enough for a canceled job to stop writing; longer for a
  // retired version students may still be streaming.
  delayMinutes = TRANSCODE_CLEANUP_DELAY_MINUTES,
  options: TranscodeCleanupOptions = {},
): Promise<void> => {
  try {
    await createCleanupSchedule(params, delayMinutes, options);
  } catch (error) {
    logger?.error('Failed to schedule transcode cleanup', {
      error,
      ...params,
    });
  }
};

/**
 * As scheduleTranscodeCleanup, but not best-effort: it's the only remaining
 * way to clean up a submission whose mediaConvertJobId was never stamped
 * (see transcode-outcome.ts), and the only guard against a submit request
 * that crashes after copying a file, so a failure has to propagate and let
 * the caller retry or fail. Throws on any failure except the schedule
 * already existing -- EventBridge delivers MediaConvert job state changes
 * at-least-once, and a duplicate COMPLETE/ERROR event for the same job
 * computes this same deterministic name, which is a no-op here, not a
 * failure.
 */
export const scheduleTranscodeCleanupOrThrow = async (
  params: TranscodeCleanupParams,
  delayMinutes = TRANSCODE_CLEANUP_DELAY_MINUTES,
  options: TranscodeCleanupOptions = {},
): Promise<void> => {
  try {
    await createCleanupSchedule(params, delayMinutes, options);
  } catch (error) {
    if (error instanceof ConflictException) {
      return;
    }
    throw error;
  }
};
