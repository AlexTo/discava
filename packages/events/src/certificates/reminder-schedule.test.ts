/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleCertificateReminder } from './reminder-schedule.js';

const {
  schedulerSend,
  resolveAppConfigValue,
  callLocalEventRunner,
  isLocalDev,
  FakeConflictException,
} = vi.hoisted(() => ({
  schedulerSend: vi.fn(),
  resolveAppConfigValue: vi.fn(),
  callLocalEventRunner: vi.fn(),
  isLocalDev: vi.fn(),
  FakeConflictException: class extends Error {
    name = 'ConflictException';
  },
}));

vi.mock('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: vi.fn(function () {
    return { send: schedulerSend };
  }),
  CreateScheduleCommand: vi.fn(function (input) {
    return { __command: 'CreateSchedule', ...input };
  }),
  ConflictException: FakeConflictException,
}));
vi.mock('@discava/common-server-utils/lesson-media-bucket', () => ({
  resolveAppConfigValue,
}));
vi.mock('@discava/common-server-utils/local-dev', () => ({
  callLocalEventRunner,
  isLocalDev,
}));

const params = {
  userId: 'user-1',
  courseId: 'course-1',
  certificateId: 'ABCDEFGH23',
  dueAt: '2026-11-20T10:11:12.345Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  isLocalDev.mockReturnValue(false);
  resolveAppConfigValue.mockResolvedValue({
    lambdaArn: 'arn:aws:lambda:ap-southeast-2:1:function:reminder',
    schedulerRoleArn: 'arn:aws:iam::1:role/scheduler',
    scheduleGroupName: 'reminders',
  });
  schedulerSend.mockResolvedValue({});
});

describe('scheduleCertificateReminder', () => {
  it('creates a one-time schedule named for the certificate, due at the second', async () => {
    await scheduleCertificateReminder(params);

    expect(resolveAppConfigValue).toHaveBeenCalledWith(
      'certificates',
      'Reminder',
    );
    expect(schedulerSend).toHaveBeenCalledWith(
      expect.objectContaining({
        __command: 'CreateSchedule',
        Name: 'cert-reminder-ABCDEFGH23',
        GroupName: 'reminders',
        ScheduleExpression: 'at(2026-11-20T10:11:12)',
        FlexibleTimeWindow: { Mode: 'OFF' },
        ActionAfterCompletion: 'DELETE',
        Target: {
          Arn: 'arn:aws:lambda:ap-southeast-2:1:function:reminder',
          RoleArn: 'arn:aws:iam::1:role/scheduler',
          Input: JSON.stringify({ userId: 'user-1', courseId: 'course-1' }),
        },
      }),
    );
    expect(callLocalEventRunner).not.toHaveBeenCalled();
  });

  it('treats an existing schedule as success', async () => {
    schedulerSend.mockRejectedValue(new FakeConflictException('exists'));

    await expect(scheduleCertificateReminder(params)).resolves.toBeUndefined();
  });

  it('throws any other error', async () => {
    schedulerSend.mockRejectedValue(new Error('throttled'));

    await expect(scheduleCertificateReminder(params)).rejects.toThrow(
      'throttled',
    );
  });

  it('asks the local event runner in local dev', async () => {
    isLocalDev.mockReturnValue(true);

    await scheduleCertificateReminder(params);

    expect(callLocalEventRunner).toHaveBeenCalledWith(
      'POST',
      '/schedules/certificate-reminder',
      { payload: { userId: 'user-1', courseId: 'course-1' } },
    );
    expect(schedulerSend).not.toHaveBeenCalled();
  });
});
