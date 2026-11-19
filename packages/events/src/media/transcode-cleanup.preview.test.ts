/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transcodeCleanup } from './transcode-cleanup.js';

const { s3Send, previewGet } = vi.hoisted(() => ({
  s3Send: vi.fn(),
  previewGet: vi.fn(),
}));

vi.mock('@discava/core-table', () => ({
  createCoreTableService: vi.fn(async () => ({
    entities: { coursePreview: { get: previewGet } },
  })),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function () {
    return { send: s3Send };
  }),
  ListObjectsV2Command: vi.fn(function (input) {
    return { __command: 'ListObjectsV2', ...input };
  }),
  DeleteObjectsCommand: vi.fn(function (input) {
    return { __command: 'DeleteObjects', ...input };
  }),
}));

vi.mock('@discava/common-server-utils/lesson-media-bucket', () => ({
  resolveLessonMediaBucketName: async () => 'media-bucket',
}));

const PREFIX = 'courses/course-1/preview/nonce-1/';
const event = {
  target: 'coursePreview',
  courseId: 'course-1',
  submissionNonce: 'nonce-1',
};

const recordWith = (record: Record<string, unknown> | null) =>
  previewGet.mockReturnValue({ go: async () => ({ data: record }) });

beforeEach(() => {
  vi.clearAllMocks();
  s3Send
    .mockResolvedValueOnce({
      Contents: [{ Key: `${PREFIX}master.m3u8` }],
      IsTruncated: false,
    })
    .mockResolvedValueOnce({});
});

describe('transcodeCleanup for a course preview', () => {
  it('deletes the attempt folder when no version of the record uses it', async () => {
    recordWith({
      s3Key: 'courses/course-1/preview/other/master.m3u8',
      previousS3Key: 'courses/course-1/preview/older/master.m3u8',
    });

    await transcodeCleanup(event);

    expect(previewGet).toHaveBeenCalledWith({ courseId: 'course-1' });
    expect(s3Send).toHaveBeenCalledWith(
      expect.objectContaining({ __command: 'ListObjectsV2', Prefix: PREFIX }),
    );
    expect(s3Send).toHaveBeenCalledWith(
      expect.objectContaining({
        __command: 'DeleteObjects',
        Delete: { Objects: [{ Key: `${PREFIX}master.m3u8` }] },
      }),
    );
  });

  it('deletes it when the preview was removed', async () => {
    recordWith(null);

    await transcodeCleanup(event);

    expect(s3Send).toHaveBeenCalledTimes(2);
  });

  it.each(['s3Key', 'previousS3Key'])(
    'keeps it while it is the record’s %s',
    async (attribute) => {
      recordWith({ [attribute]: `${PREFIX}master.m3u8` });

      await transcodeCleanup(event);

      expect(s3Send).not.toHaveBeenCalled();
    },
  );

  it('still takes a lesson payload with no target, as before', async () => {
    await transcodeCleanup({
      courseId: 'course-1',
      moduleId: 'm',
      lessonId: 'l',
      contentItemId: 'i',
      submissionNonce: 'nonce-1',
    });

    expect(previewGet).not.toHaveBeenCalled();
    expect(s3Send).toHaveBeenCalledWith(
      expect.objectContaining({
        Prefix: 'courses/course-1/modules/m/lessons/l/content-items/i/nonce-1/',
      }),
    );
  });
});
