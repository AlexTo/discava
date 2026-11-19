/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { PREVIEW_MAX_SECONDS } from '@discava/core-table';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transcodeComplete } from './transcode-complete.js';

const {
  previewPatch,
  contentItemPatch,
  patchSet,
  patchRemove,
  patchAdd,
  patchWhere,
  patchGo,
  startCaptionJob,
  s3Send,
  scheduleTranscodeCleanupOrThrow,
} = vi.hoisted(() => ({
  previewPatch: vi.fn(),
  contentItemPatch: vi.fn(),
  patchSet: vi.fn(),
  patchRemove: vi.fn(),
  patchAdd: vi.fn(),
  patchWhere: vi.fn(),
  patchGo: vi.fn(),
  startCaptionJob: vi.fn(),
  s3Send: vi.fn(),
  scheduleTranscodeCleanupOrThrow: vi.fn(),
}));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: {
      coursePreview: { patch: previewPatch },
      contentItem: { patch: contentItemPatch },
    },
  })),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function () {
    return { send: s3Send };
  }),
  DeleteObjectCommand: vi.fn(function (input) {
    return input;
  }),
}));

vi.mock('./transcribe-client.js', () => ({ startCaptionJob }));

vi.mock('@discava/common-server-utils/lesson-media-bucket', () => ({
  resolveLessonMediaUploadBucketName: async () => 'uploads',
}));

vi.mock('@discava/common-server-utils/cleanup-scheduler', () => ({
  scheduleTranscodeCleanupOrThrow,
}));

const conditionalCheckFailedError = (): Error =>
  Object.assign(new Error('The conditional request failed'), {
    cause: Object.assign(new Error('The conditional request failed'), {
      name: 'ConditionalCheckFailedException',
    }),
  });

const RAW = 'courses/course-1/preview/raw.mp4';
const NONCE = 'nonce-2';

const previewEvent = (status: string, durationInMs?: number) => ({
  version: '0',
  id: 'event-1',
  source: 'aws.mediaconvert',
  account: 'test-account',
  time: '2024-01-01T00:00:00.000Z',
  region: 'ap-southeast-2',
  resources: [],
  'detail-type': 'MediaConvert Job State Change',
  detail: {
    jobId: 'job-1',
    status,
    userMetadata: {
      target: 'coursePreview',
      courseId: 'course-1',
      rawObjectKey: RAW,
      submissionNonce: NONCE,
    },
    ...(durationInMs !== undefined && {
      outputGroupDetails: [
        { outputDetails: [{ durationInMs }] },
        { outputDetails: [{ durationInMs: durationInMs - 40 }] },
      ],
    }),
  },
});

const condition = (call: number) =>
  patchWhere.mock.calls[call][0](new Proxy({}, { get: (_, name) => name }), {
    eq: (a: string, v: string) => `${a}=${v}`,
  });

beforeEach(() => {
  vi.clearAllMocks();
  previewPatch.mockReturnValue({ set: patchSet });
  patchSet.mockReturnValue({ remove: patchRemove });
  patchRemove.mockReturnValue({ add: patchAdd, where: patchWhere });
  patchAdd.mockReturnValue({ where: patchWhere });
  patchWhere.mockReturnValue({ go: patchGo });
  patchGo.mockResolvedValue({ data: {} });
  startCaptionJob.mockResolvedValue(undefined);
  s3Send.mockResolvedValue({});
  scheduleTranscodeCleanupOrThrow.mockResolvedValue(undefined);
});

describe('transcodeComplete for a course preview', () => {
  it('marks the preview ready under its own folder, with the transcoded duration', async () => {
    await transcodeComplete(previewEvent('COMPLETE', 90_400) as any);

    expect(contentItemPatch).not.toHaveBeenCalled();
    expect(previewPatch).toHaveBeenCalledWith({ courseId: 'course-1' });
    expect(patchSet).toHaveBeenCalledWith({
      status: 'ready',
      s3Key: `courses/course-1/preview/${NONCE}/master.m3u8`,
      captionsStatus: 'pending',
      captionsPendingSince: expect.any(String),
      durationSeconds: 90,
    });
    expect(patchRemove).toHaveBeenCalledWith([
      'previousS3Key',
      'captionTracks',
      'failureReason',
      'transcodePending',
      'transcodePendingSince',
    ]);
    expect(patchAdd).toHaveBeenCalledWith({ captionTracksRev: 1 });
    // Only while the record still has this submission.
    expect(condition(0)).toBe(`submissionNonce=${NONCE}`);
    expect(patchGo).toHaveBeenCalledWith({ response: 'all_old' });
  });

  it('starts the automatic captions for the preview and deletes the raw upload', async () => {
    await transcodeComplete(previewEvent('COMPLETE', 60_000) as any);

    expect(startCaptionJob).toHaveBeenCalledExactlyOnceWith({
      target: 'coursePreview',
      courseId: 'course-1',
      nonce: NONCE,
    });
    expect(s3Send).toHaveBeenCalledWith({ Bucket: 'uploads', Key: RAW });
  });

  it('schedules the replaced version for cleanup once the replacement is ready', async () => {
    patchGo.mockResolvedValue({
      data: { previousS3Key: 'courses/course-1/preview/old-nonce/master.m3u8' },
    });

    await transcodeComplete(previewEvent('COMPLETE', 60_000) as any);

    expect(scheduleTranscodeCleanupOrThrow).toHaveBeenCalledExactlyOnceWith(
      {
        target: 'coursePreview',
        courseId: 'course-1',
        submissionNonce: 'old-nonce',
      },
      expect.any(Number),
    );
  });

  it('fails a preview over the length limit as too-long, keeping the previous version, and schedules its output for cleanup', async () => {
    await transcodeComplete(
      previewEvent('COMPLETE', (PREVIEW_MAX_SECONDS + 1) * 1000) as any,
    );

    expect(patchSet).toHaveBeenCalledExactlyOnceWith({
      status: 'failed',
      failureReason: 'too-long',
    });
    // previousS3Key is left alone: it is not in what is removed.
    expect(patchRemove).toHaveBeenCalledWith([
      'transcodePending',
      'transcodePendingSince',
    ]);
    expect(scheduleTranscodeCleanupOrThrow).toHaveBeenCalledExactlyOnceWith({
      target: 'coursePreview',
      courseId: 'course-1',
      submissionNonce: NONCE,
    });
    expect(startCaptionJob).not.toHaveBeenCalled();
    expect(s3Send).toHaveBeenCalledWith({ Bucket: 'uploads', Key: RAW });
  });

  it('accepts a preview exactly at the limit', async () => {
    await transcodeComplete(
      previewEvent('COMPLETE', PREVIEW_MAX_SECONDS * 1000) as any,
    );

    expect(patchSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready' }),
    );
  });

  it('fails a preview as a transcode error on ERROR', async () => {
    await transcodeComplete(previewEvent('ERROR') as any);

    expect(patchSet).toHaveBeenCalledExactlyOnceWith({
      status: 'failed',
      failureReason: 'transcode-error',
    });
    expect(startCaptionJob).not.toHaveBeenCalled();
  });

  it('leaves a stale event alone and schedules its own output for cleanup', async () => {
    patchGo.mockRejectedValue(conditionalCheckFailedError());

    await transcodeComplete(previewEvent('COMPLETE', 60_000) as any);

    expect(scheduleTranscodeCleanupOrThrow).toHaveBeenCalledExactlyOnceWith({
      target: 'coursePreview',
      courseId: 'course-1',
      submissionNonce: NONCE,
    });
    expect(startCaptionJob).not.toHaveBeenCalled();
    expect(s3Send).not.toHaveBeenCalled();
  });

  it('rethrows a transient failure so the event is retried', async () => {
    patchGo.mockRejectedValue(new Error('DynamoDB is unavailable'));

    await expect(
      transcodeComplete(previewEvent('COMPLETE', 60_000) as any),
    ).rejects.toThrow('DynamoDB is unavailable');
  });
});
