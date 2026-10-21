/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transcodeReconciler } from './transcode-reconciler.js';

const {
  pending,
  queryLt,
  patch,
  patchSet,
  patchRemove,
  patchWhere,
  patchGo,
  send,
  applyTranscodeOutcome,
} = vi.hoisted(() => ({
  pending: [] as Record<string, unknown>[],
  queryLt: vi.fn(),
  patch: vi.fn(),
  patchSet: vi.fn(),
  patchRemove: vi.fn(),
  patchWhere: vi.fn(),
  patchGo: vi.fn(),
  send: vi.fn(),
  applyTranscodeOutcome: vi.fn(),
}));

vi.mock('./transcode-outcome.js', () => ({
  applyTranscodeOutcome,
  getCoreTable: async () => ({
    entities: {
      contentItem: {
        query: {
          byTranscodePending: () => ({
            lt: (range: unknown) => {
              queryLt(range);
              return { go: async () => ({ data: pending }) };
            },
          }),
        },
        patch,
      },
    },
  }),
}));

vi.mock('@aws-sdk/client-mediaconvert', () => ({
  MediaConvertClient: vi.fn(function () {
    return { send };
  }),
  GetJobCommand: vi.fn(function (input) {
    return input;
  }),
  NotFoundException: class NotFoundException extends Error {},
}));

const conditionalCheckFailed = () =>
  Object.assign(new Error('The conditional request failed'), {
    cause: Object.assign(new Error('The conditional request failed'), {
      name: 'ConditionalCheckFailedException',
    }),
  });

const NOW = new Date('2026-10-21T12:00:00.000Z').getTime();
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const video = (overrides: Record<string, unknown> = {}) => ({
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
  contentItemId: 'item-1',
  status: 'pending',
  s3Key: 'courses/course-1/…/item-1/raw.mp4',
  submissionNonce: 'nonce-1',
  mediaConvertJobId: 'job-1',
  transcodePendingSince: minutesAgo(180),
  ...overrides,
});

const run = () =>
  transcodeReconciler({} as Parameters<typeof transcodeReconciler>[0]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  pending.length = 0;
  patch.mockReturnValue({ set: patchSet });
  patchSet.mockReturnValue({ remove: patchRemove });
  patchRemove.mockReturnValue({ where: patchWhere });
  patchWhere.mockReturnValue({ go: patchGo });
  patchGo.mockResolvedValue({});
});

const jobIs = (Status: string) =>
  send.mockResolvedValue({
    Job: {
      Status,
      UserMetadata: {
        rawObjectKey: 'courses/course-1/…/item-1/raw.mp4',
        submissionNonce: 'nonce-1',
      },
    },
  });

describe('transcodeReconciler', () => {
  it('only reads videos pending for longer than the no-job grace period', async () => {
    await run();

    expect(queryLt).toHaveBeenCalledWith({
      transcodePendingSince: minutesAgo(30),
    });
    expect(send).not.toHaveBeenCalled();
  });

  it.each(['COMPLETE', 'ERROR'])(
    'applies a %s whose event never arrived, as transcode-complete would',
    async (status) => {
      pending.push(video());
      jobIs(status);

      await run();

      expect(send).toHaveBeenCalledWith({ Id: 'job-1' });
      expect(applyTranscodeOutcome).toHaveBeenCalledWith(expect.anything(), {
        jobId: 'job-1',
        status,
        courseId: 'course-1',
        moduleId: 'module-1',
        lessonId: 'lesson-1',
        contentItemId: 'item-1',
        rawObjectKey: 'courses/course-1/…/item-1/raw.mp4',
        submissionNonce: 'nonce-1',
      });
    },
  );

  it.each(['SUBMITTED', 'PROGRESSING'])(
    'leaves a job still %s alone',
    async (status) => {
      pending.push(video());
      jobIs(status);

      await run();

      expect(applyTranscodeOutcome).not.toHaveBeenCalled();
      expect(patch).not.toHaveBeenCalled();
    },
  );

  it('doesn’t ask MediaConvert about a job until it’s been pending a while', async () => {
    pending.push(video({ transcodePendingSince: minutesAgo(60) }));

    await run();

    expect(send).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it('marks failed a video that never got a job, still waiting for its submission', async () => {
    pending.push(
      video({
        mediaConvertJobId: undefined,
        transcodePendingSince: minutesAgo(45),
      }),
    );

    await run();

    expect(send).not.toHaveBeenCalled();
    expect(patchSet).toHaveBeenCalledWith({ status: 'failed' });
    expect(patchRemove).toHaveBeenCalledWith([
      'transcodePending',
      'transcodePendingSince',
    ]);
    // Only if it's still this submission, still pending.
    const condition = patchWhere.mock.calls[0][0](
      new Proxy({}, { get: (_, name) => name }),
      {
        eq: (a: string, v: string) => `${a}=${v}`,
        notExists: (a: string) => `notExists(${a})`,
      },
    );
    expect(condition).toBe('status=pending AND submissionNonce=nonce-1');
  });

  it.each([
    ['canceled', () => jobIs('CANCELED')],
    [
      'gone',
      () =>
        send.mockImplementation(async () => {
          const { NotFoundException } = await import(
            '@aws-sdk/client-mediaconvert'
          );
          throw new NotFoundException('no such job');
        }),
    ],
  ])('marks failed a video whose job is %s', async (_, arrange) => {
    pending.push(video());
    arrange();

    await run();

    expect(patchSet).toHaveBeenCalledWith({ status: 'failed' });
    expect(applyTranscodeOutcome).not.toHaveBeenCalled();
  });

  it('leaves a video a replacement or late completion settled first', async () => {
    pending.push(video({ mediaConvertJobId: undefined }));
    patchGo.mockRejectedValue(conditionalCheckFailed());

    await expect(run()).resolves.toBeUndefined();
  });

  it('carries on past a video it couldn’t reconcile', async () => {
    pending.push(
      video({ contentItemId: 'item-1' }),
      video({ contentItemId: 'item-2' }),
    );
    send
      .mockRejectedValueOnce(new Error('MediaConvert is unavailable'))
      .mockResolvedValueOnce({ Job: { Status: 'COMPLETE', UserMetadata: {} } });

    await expect(run()).resolves.toBeUndefined();
    expect(applyTranscodeOutcome).toHaveBeenCalledTimes(1);
    expect(applyTranscodeOutcome.mock.calls[0][1]).toMatchObject({
      contentItemId: 'item-2',
      // Falls back to the item's own when the job carries none.
      submissionNonce: 'nonce-1',
    });
  });
});
