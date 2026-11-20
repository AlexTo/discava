/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  ConflictException,
  CreateScheduleCommand,
  SchedulerClient,
} from '@aws-sdk/client-scheduler';
import { resolveAppConfigValue } from '@discava/common-server-utils/lesson-media-bucket';
import {
  callLocalEventRunner,
  isLocalDev,
  type LocalScheduleRequest,
} from '@discava/common-server-utils/local-dev';

let _schedulerClient: SchedulerClient | undefined;

const getSchedulerClient = (): SchedulerClient => {
  if (!_schedulerClient) {
    _schedulerClient = new SchedulerClient({});
  }
  return _schedulerClient;
};

// Published by the stream router stack alongside the certificate-reminder
// Lambda itself.
type CertificateReminderConfig = {
  lambdaArn: string;
  schedulerRoleArn: string;
  scheduleGroupName: string;
};

export interface ScheduleCertificateReminderParams {
  userId: string;
  courseId: string;
  /** The stored form: it names the schedule. */
  certificateId: string;
  /** ISO instant the reminder is due: certificateReminderDueAt(certificate). */
  dueAt: string;
}

/**
 * Creates the one-time EventBridge Scheduler schedule that invokes the
 * certificate-reminder Lambda at `dueAt`. The schedule's name is the
 * certificate's, so scheduling twice is a no-op: a schedule that already
 * exists counts as success. Any other error is thrown, so the caller's batch
 * is retried. In local dev the event runner runs the handler after its own
 * delay instead.
 */
export const scheduleCertificateReminder = async ({
  userId,
  courseId,
  certificateId,
  dueAt,
}: ScheduleCertificateReminderParams): Promise<void> => {
  const payload = { userId, courseId };
  if (isLocalDev()) {
    await callLocalEventRunner('POST', '/schedules/certificate-reminder', {
      payload,
    } satisfies LocalScheduleRequest);
    return;
  }
  const { lambdaArn, schedulerRoleArn, scheduleGroupName } =
    await resolveAppConfigValue<CertificateReminderConfig>(
      'certificates',
      'Reminder',
    );
  try {
    await getSchedulerClient().send(
      new CreateScheduleCommand({
        Name: `cert-reminder-${certificateId}`,
        GroupName: scheduleGroupName,
        // at() takes a literal timestamp with no timezone or fractions.
        ScheduleExpression: `at(${dueAt.slice(0, 19)})`,
        FlexibleTimeWindow: { Mode: 'OFF' },
        ActionAfterCompletion: 'DELETE',
        Target: {
          Arn: lambdaArn,
          RoleArn: schedulerRoleArn,
          Input: JSON.stringify(payload),
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
