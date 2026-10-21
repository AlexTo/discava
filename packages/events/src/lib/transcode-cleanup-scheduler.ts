/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import {
  ConflictException,
  CreateScheduleCommand,
  SchedulerClient,
} from '@aws-sdk/client-scheduler';
import { resolveTranscodeCleanupConfig } from './runtime-config.js';

let _schedulerClient: SchedulerClient | undefined;

const getSchedulerClient = (): SchedulerClient => {
  if (!_schedulerClient) {
    _schedulerClient = new SchedulerClient({});
  }
  return _schedulerClient;
};

// Same one-time, delayed-invocation mechanism as instructor-api's own
// scheduleTranscodeCleanup (same target Lambda, same deterministic name),
// but can't reuse that one directly -- packages/events can't depend on
// packages/apis/instructor-api. Unlike that one, this isn't best-effort:
// it's called from transcode-complete.ts as the only remaining way to
// clean up a submission whose mediaConvertJobId was never stamped (see
// that file's docstring), so a failure here has to propagate and let
// EventBridge retry the whole invocation rather than being silently
// logged and dropped.
const TRANSCODE_CLEANUP_DELAY_MINUTES = 10;

/**
 * Schedules a one-time cleanup of a single job's own nonce-scoped S3
 * output. Throws on any failure except the schedule already existing --
 * EventBridge delivers MediaConvert job state changes at-least-once, and a
 * duplicate COMPLETE/ERROR event for the same job computes this same
 * deterministic name, which is a no-op here, not a failure.
 */
export const scheduleTranscodeCleanupOrThrow = async (
  params: {
    courseId: string;
    moduleId: string;
    lessonId: string;
    contentItemId: string;
    submissionNonce: string;
  },
  // How long to wait: by default long enough for a canceled job to stop
  // writing; longer for a retired version students may still be streaming.
  delayMinutes = TRANSCODE_CLEANUP_DELAY_MINUTES,
): Promise<void> => {
  const { lambdaArn, schedulerRoleArn, scheduleGroupName } =
    await resolveTranscodeCleanupConfig();

  // Same schedule-name formula as instructor-api's scheduler -- not because
  // the two ever target the same nonce (mutually exclusive: a job either
  // gets its mediaConvertJobId stamped, in which case instructor-api
  // schedules its cleanup at cancel time, or it doesn't, in which case
  // only this path ever does), just for consistency.
  const scheduleName = `cleanup-${createHash('sha256')
    .update(`${params.contentItemId}:${params.submissionNonce}`)
    .digest('hex')
    .slice(0, 32)}`;

  // EventBridge Scheduler's at() expression takes a literal local
  // timestamp with no timezone suffix or fractional seconds.
  const runAt = new Date(Date.now() + delayMinutes * 60_000)
    .toISOString()
    .slice(0, 19);

  try {
    await getSchedulerClient().send(
      new CreateScheduleCommand({
        Name: scheduleName,
        GroupName: scheduleGroupName,
        ScheduleExpression: `at(${runAt})`,
        FlexibleTimeWindow: { Mode: 'OFF' },
        ActionAfterCompletion: 'DELETE',
        Target: {
          Arn: lambdaArn,
          RoleArn: schedulerRoleArn,
          Input: JSON.stringify(params),
        },
      }),
    );
  } catch (error) {
    if (error instanceof ConflictException) {
      return;
    }
    throw error;
  }
};
