/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Logger } from '@aws-lambda-powertools/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTranscribeOutcome } from './transcribe-outcome.js';

const { get, patch, patchSet, patchRemove, patchWhere, patchGo, s3Send } =
  vi.hoisted(() => ({
    get: vi.fn(),
    patch: vi.fn(),
    patchSet: vi.fn(),
    patchRemove: vi.fn(),
    patchWhere: vi.fn(),
    patchGo: vi.fn(),
    s3Send: vi.fn(),
  }));

const contentItemGet = vi.hoisted(() => vi.fn());

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: {
      coursePreview: { get, patch },
      contentItem: { get: contentItemGet, patch: vi.fn() },
    },
  })),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function () {
    return { send: s3Send };
  }),
  CopyObjectCommand: vi.fn(function (input) {
    return { type: 'copy', ...input };
  }),
  DeleteObjectCommand: vi.fn(function (input) {
    return { type: 'delete', ...input };
  }),
  GetObjectCommand: vi.fn(function (input) {
    return { type: 'get', ...input };
  }),
}));

vi.mock('@discava/common-server-utils/lesson-media-bucket', () => ({
  resolveLessonMediaBucketName: vi.fn(async () => 'media-bucket'),
}));

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

const NONCE = 'n1';
const SCRATCH_VTT = `courses/c1/preview/transcribe-output/${NONCE}/captions-preview-c1-n1.vtt`;
const VTT = 'WEBVTT\n\n0\n00:00:00.160 --> 00:00:01.870\nHello.\n';

const outcome = (status: string) => ({
  target: 'coursePreview' as const,
  jobName: 'captions-preview-c1-n1',
  status,
  courseId: 'c1',
  nonce: NONCE,
  vttKey: SCRATCH_VTT,
});

const pendingPreview = (overrides = {}) => ({
  status: 'ready',
  s3Key: `courses/c1/preview/${NONCE}/master.m3u8`,
  captionsStatus: 'pending',
  captionTracksRev: 3,
  captionTracks: [],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  get.mockReturnValue({ go: async () => ({ data: pendingPreview() }) });
  patch.mockReturnValue({ set: patchSet });
  patchSet.mockReturnValue({ remove: patchRemove });
  patchRemove.mockReturnValue({ where: patchWhere });
  patchWhere.mockReturnValue({ go: patchGo });
  patchGo.mockResolvedValue({});
  s3Send.mockImplementation(async (command: { type: string }) =>
    command.type === 'get'
      ? { Body: { transformToString: async () => VTT } }
      : {},
  );
});

describe('applyTranscribeOutcome for a course preview', () => {
  it('writes the track on the preview, inside the version folder', async () => {
    await applyTranscribeOutcome(logger, outcome('COMPLETED'));

    expect(contentItemGet).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith({ courseId: 'c1' });
    expect(patch).toHaveBeenCalledWith({ courseId: 'c1' });
    const set = patchSet.mock.calls[0][0];
    expect(set).toMatchObject({ captionTracksRev: 4, captionsStatus: 'ready' });
    expect(set.captionTracks).toHaveLength(1);
    expect(set.captionTracks[0]).toMatchObject({
      nonce: NONCE,
      source: 'auto',
      isDefault: true,
      key: expect.stringMatching(
        new RegExp(`^courses/c1/preview/${NONCE}/captions/.+\\.vtt$`),
      ),
    });
    const copy = s3Send.mock.calls
      .map(([c]) => c)
      .find((c) => c.type === 'copy');
    expect(copy.CopySource).toBe(`media-bucket/${SCRATCH_VTT}`);
    expect(copy.Key).toBe(set.captionTracks[0].key);
  });

  it('marks captioning failed when Transcribe failed', async () => {
    await applyTranscribeOutcome(logger, outcome('FAILED'));

    expect(patchSet).toHaveBeenCalledExactlyOnceWith({
      captionsStatus: 'failed',
    });
  });

  it('does nothing for a preview a replacement has since superseded, and drops its scratch files', async () => {
    get.mockReturnValue({
      go: async () => ({
        data: pendingPreview({ s3Key: 'courses/c1/preview/other/master.m3u8' }),
      }),
    });

    await applyTranscribeOutcome(logger, outcome('COMPLETED'));

    expect(patch).not.toHaveBeenCalled();
    expect(
      s3Send.mock.calls.map(([c]) => c).filter((c) => c.type === 'delete'),
    ).toContainEqual(expect.objectContaining({ Key: SCRATCH_VTT }));
  });
});
