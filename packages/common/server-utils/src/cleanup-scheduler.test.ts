/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  scheduleTranscodeCleanup,
  scheduleTranscodeCleanupOrThrow,
} from './cleanup-scheduler.js';

const { schedulerSend, resolveAppConfigValue, FakeConflictException } =
  vi.hoisted(() => ({
    schedulerSend: vi.fn(),
    resolveAppConfigValue: vi.fn(),
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

vi.mock('./lesson-media-bucket.js', () => ({
  resolveAppConfigValue,
}));

const COURSE_ID = 'course-1';
const MODULE_ID = 'module-1';
const LESSON_ID = 'lesson-1';
const CONTENT_ITEM_ID = 'content-item-1';
const SUBMISSION_NONCE = 'nonce-1';
const LAMBDA_ARN =
  'arn:aws:lambda:ap-southeast-2:111111111111:function:cleanup';
const SCHEDULER_ROLE_ARN = 'arn:aws:iam::111111111111:role/scheduler-role';
const SCHEDULE_GROUP_NAME = 'transcode-cleanup-group';

const params = {
  courseId: COURSE_ID,
  moduleId: MODULE_ID,
  lessonId: LESSON_ID,
  contentItemId: CONTENT_ITEM_ID,
  submissionNonce: SUBMISSION_NONCE,
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveAppConfigValue.mockResolvedValue({
    lambdaArn: LAMBDA_ARN,
    schedulerRoleArn: SCHEDULER_ROLE_ARN,
    scheduleGroupName: SCHEDULE_GROUP_NAME,
  });
  schedulerSend.mockResolvedValue({});
});

describe('scheduleTranscodeCleanupOrThrow', () => {
  it('creates a one-time schedule targeting the cleanup Lambda with this job own params', async () => {
    await scheduleTranscodeCleanupOrThrow(params);

    expect(schedulerSend).toHaveBeenCalledWith(
      expect.objectContaining({
        __command: 'CreateSchedule',
        GroupName: SCHEDULE_GROUP_NAME,
        Target: {
          Arn: LAMBDA_ARN,
          RoleArn: SCHEDULER_ROLE_ARN,
          Input: JSON.stringify(params),
        },
      }),
    );
  });

  it('derives a deterministic schedule name from the content item and nonce', async () => {
    await scheduleTranscodeCleanupOrThrow(params);
    await scheduleTranscodeCleanupOrThrow(params);

    const [firstCall] = schedulerSend.mock.calls[0]!;
    const [secondCall] = schedulerSend.mock.calls[1]!;
    expect(firstCall.Name).toBe(secondCall.Name);
  });

  it('uses a different schedule name for a different content item or nonce', async () => {
    await scheduleTranscodeCleanupOrThrow(params);
    await scheduleTranscodeCleanupOrThrow({
      ...params,
      submissionNonce: 'a-different-nonce',
    });

    const [firstCall] = schedulerSend.mock.calls[0]!;
    const [secondCall] = schedulerSend.mock.calls[1]!;
    expect(firstCall.Name).not.toBe(secondCall.Name);
  });

  // EventBridge delivers MediaConvert job state changes at-least-once, so
  // transcode-complete.ts can call this twice for the same job -- both
  // calls compute the same deterministic name, and the second CreateSchedule
  // conflicts. That's not a failure, just confirmation cleanup is already
  // scheduled -- must not throw, or a duplicate event would fail retries
  // forever.
  it('does not throw when the schedule already exists (duplicate terminal event)', async () => {
    schedulerSend.mockRejectedValue(
      new FakeConflictException('Schedule already exists'),
    );

    await expect(
      scheduleTranscodeCleanupOrThrow(params),
    ).resolves.toBeUndefined();
  });

  // Any other failure has to propagate -- this isn't best-effort like
  // instructor-api's own scheduler (see the module docstring): it's the
  // only remaining cleanup path for a submission whose mediaConvertJobId
  // was never stamped, so a caller has to be able to retry it.
  it('propagates a genuine scheduling failure', async () => {
    schedulerSend.mockRejectedValue(new Error('Access denied'));

    await expect(scheduleTranscodeCleanupOrThrow(params)).rejects.toThrow(
      'Access denied',
    );
  });
});

describe('scheduleTranscodeCleanup (best effort)', () => {
  const logger = { error: vi.fn() };

  it('creates the same schedule as the throwing variant', async () => {
    await scheduleTranscodeCleanup(logger as never, params);

    expect(schedulerSend).toHaveBeenCalledWith(
      expect.objectContaining({
        __command: 'CreateSchedule',
        GroupName: SCHEDULE_GROUP_NAME,
        Target: {
          Arn: LAMBDA_ARN,
          RoleArn: SCHEDULER_ROLE_ARN,
          Input: JSON.stringify(params),
        },
      }),
    );
  });

  it('logs a scheduling failure instead of throwing', async () => {
    schedulerSend.mockRejectedValue(new Error('Access denied'));

    await expect(
      scheduleTranscodeCleanup(logger as never, params),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to schedule transcode cleanup',
      expect.objectContaining({ contentItemId: CONTENT_ITEM_ID }),
    );
  });

  it('waits the given number of minutes', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    try {
      await scheduleTranscodeCleanup(logger as never, params, 255);
    } finally {
      vi.useRealTimers();
    }

    expect(schedulerSend.mock.calls[0]![0].ScheduleExpression).toBe(
      'at(2026-01-01T04:15:00)',
    );
  });
});

describe('cleanup options', () => {
  it('passes keepIfCurrentFor and the purpose through in the payload', async () => {
    await scheduleTranscodeCleanupOrThrow(params, 60, {
      keepIfCurrentFor: 'user-1',
      purpose: 'attempt',
    });

    expect(schedulerSend.mock.calls[0]![0].Target.Input).toBe(
      JSON.stringify({
        ...params,
        keepIfCurrentFor: 'user-1',
        purpose: 'attempt',
      }),
    );
  });

  it('names the schedules for one folder differently by purpose', async () => {
    await scheduleTranscodeCleanupOrThrow(params, 60, { purpose: 'attempt' });
    await scheduleTranscodeCleanupOrThrow(params, 60, { purpose: 'retire' });
    await scheduleTranscodeCleanupOrThrow(params);

    const names = schedulerSend.mock.calls.map(([command]) => command.Name);
    expect(new Set(names).size).toBe(3);
    for (const name of names) {
      expect(name).toMatch(/^cleanup-[0-9a-f]{32}$/);
    }
  });

  it('names a schedule without a purpose exactly as before purposes existed', async () => {
    await scheduleTranscodeCleanupOrThrow(params);

    expect(schedulerSend.mock.calls[0]![0].Name).toBe(
      `cleanup-${createHash('sha256')
        .update(`${CONTENT_ITEM_ID}:${SUBMISSION_NONCE}`)
        .digest('hex')
        .slice(0, 32)}`,
    );
  });

  it('asks the local event runner for a longer delay when told to', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubEnv('LOCAL_DEV', 'true');
    vi.stubGlobal('fetch', fetchMock);
    try {
      await scheduleTranscodeCleanupOrThrow(params, 60, {
        keepIfCurrentFor: 'user-1',
        purpose: 'attempt',
        localDelaySeconds: 60,
      });
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:2024/schedules/transcode-cleanup',
      expect.objectContaining({
        body: JSON.stringify({
          payload: {
            ...params,
            keepIfCurrentFor: 'user-1',
            purpose: 'attempt',
          },
          delaySeconds: 60,
        }),
      }),
    );
  });
});

describe('in local dev (#137)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('LOCAL_DEV', 'true');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const params = {
    courseId: COURSE_ID,
    moduleId: MODULE_ID,
    lessonId: LESSON_ID,
    contentItemId: CONTENT_ITEM_ID,
    submissionNonce: SUBMISSION_NONCE,
  };

  it('has the event runner run the cleanup instead of Scheduler', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));

    await scheduleTranscodeCleanupOrThrow(params);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:2024/schedules/transcode-cleanup',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ payload: params }),
      }),
    );
    expect(schedulerSend).not.toHaveBeenCalled();
  });

  it('throws when the event runner refuses, as for Scheduler', async () => {
    fetchMock.mockResolvedValue(new Response('down', { status: 500 }));

    await expect(scheduleTranscodeCleanupOrThrow(params)).rejects.toThrow(
      'refused POST /schedules/transcode-cleanup',
    );
  });
});
