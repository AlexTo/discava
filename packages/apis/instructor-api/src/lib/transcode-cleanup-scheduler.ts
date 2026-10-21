/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import type { Logger } from '@aws-lambda-powertools/logger';
import {
  CreateScheduleCommand,
  SchedulerClient,
} from '@aws-sdk/client-scheduler';
import {
  callLocalEventRunner,
  isLocalDev,
  type LocalScheduleRequest,
} from '@discava/common-server-utils/local-dev';
import { resolveAppConfigValue } from './runtime-config.js';

// Shared by mediaconvert-client.ts (a canceled job's own output) and
// s3-client.ts (an already-`ready` video's output, superseded by a
// replace or removed by a delete) -- pulled out into its own module
// specifically so s3-client.ts can use it without creating a circular
// import (mediaconvert-client.ts already imports bucket-name resolvers
// from s3-client.ts).
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
  params: {
    courseId: string;
    moduleId: string;
    lessonId: string;
    contentItemId: string;
    submissionNonce: string;
  },
  // By default long enough for a canceled job to stop writing; longer for a
  // retired version students may still be streaming.
  delayMinutes = TRANSCODE_CLEANUP_DELAY_MINUTES,
): Promise<void> => {
  try {
    // Local dev's event runner runs it after a short delay instead (#137).
    if (isLocalDev()) {
      await callLocalEventRunner('POST', '/schedules/transcode-cleanup', {
        payload: params,
      } satisfies LocalScheduleRequest);
      return;
    }
    const { lambdaArn, schedulerRoleArn, scheduleGroupName } =
      await resolveTranscodeCleanupConfig();

    // Schedule names cap out at 64 characters; a hash of the two ids that
    // actually identify this job's own prefix keeps this well within
    // that regardless of their length, and needs no other uniqueness --
    // the identifying detail lives in the target's Input, not the name.
    const scheduleName = `cleanup-${createHash('sha256')
      .update(`${params.contentItemId}:${params.submissionNonce}`)
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
        // reuses a specific job's cleanup schedule, so there's no reason
        // to let it linger.
        ActionAfterCompletion: 'DELETE',
        Target: {
          Arn: lambdaArn,
          RoleArn: schedulerRoleArn,
          Input: JSON.stringify(params),
        },
      }),
    );
  } catch (error) {
    logger?.error('Failed to schedule transcode cleanup', {
      error,
      ...params,
    });
  }
};
