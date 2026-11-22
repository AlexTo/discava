/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  create,
  createUploadUrl,
  createVideoUrl,
  remove,
  replace,
} from './course-preview.js';

const {
  courseInstructorGet,
  previewGet,
  previewCreate,
  previewPatch,
  previewPatchSet,
  previewPatchRemove,
  previewPatchWhere,
  previewPatchGo,
  previewDelete,
  previewDeleteWhere,
  previewDeleteGo,
  getSignedUrl,
  getVideoUploadETag,
  bestEffortDeletePreviewUploads,
  submitTranscodeJob,
  bestEffortCancelTranscodeJob,
  scheduleTranscodeCleanup,
  getSignedCloudFrontCookies,
  courseUpdate,
  courseGet,
} = vi.hoisted(() => ({
  courseInstructorGet: vi.fn(),
  previewGet: vi.fn(),
  previewCreate: vi.fn(),
  previewPatch: vi.fn(),
  previewPatchSet: vi.fn(),
  previewPatchRemove: vi.fn(),
  previewPatchWhere: vi.fn(),
  previewPatchGo: vi.fn(),
  previewDelete: vi.fn(),
  previewDeleteWhere: vi.fn(),
  previewDeleteGo: vi.fn(),
  getSignedUrl: vi.fn(),
  getVideoUploadETag: vi.fn(),
  bestEffortDeletePreviewUploads: vi.fn(),
  submitTranscodeJob: vi.fn(),
  bestEffortCancelTranscodeJob: vi.fn(),
  scheduleTranscodeCleanup: vi.fn(),
  getSignedCloudFrontCookies: vi.fn(),
  courseUpdate: vi.fn(),
  courseGet: vi.fn(),
}));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: {
      // Any write to the course would show up here: previews must never touch it.
      course: { patch: courseUpdate, update: courseUpdate, get: courseGet },
      courseInstructor: { get: courseInstructorGet },
      coursePreview: {
        get: previewGet,
        create: previewCreate,
        patch: previewPatch,
        delete: previewDelete,
      },
    },
  })),
}));

vi.mock(
  '@discava/common-server-utils/caption-translation-settings',
  async (importActual) => ({
    ...(await importActual<object>()),
    resolveCaptionTranslationSettings: async () => ({
      enabled: true,
      maxLanguagesPerCourse: 9,
    }),
  }),
);
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(),
  PutObjectCommand: vi.fn(function (input) {
    return input;
  }),
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl }));
vi.mock('@discava/common-server-utils/lesson-media-bucket', () => ({
  getS3Client: () => ({}),
  resolveLessonMediaUploadBucketName: async () => 'upload-bucket',
}));
vi.mock('@discava/common-server-utils/lesson-media', () => ({
  getCloudFrontVideoUrl: async (key: string) => `https://media.test/${key}`,
  getSignedCloudFrontCookies,
}));
vi.mock('@discava/common-server-utils/cleanup-scheduler', () => ({
  scheduleTranscodeCleanup,
}));
vi.mock('../helpers/s3-client.js', () => ({
  getVideoUploadETag,
  bestEffortDeletePreviewUploads,
}));
vi.mock('../helpers/mediaconvert-client.js', () => ({
  submitTranscodeJob,
  bestEffortCancelTranscodeJob,
}));

const router = t.router({
  createUploadUrl,
  create,
  replace,
  remove,
  createVideoUrl,
});

const SUB = 'instructor-1';
const COURSE = 'course-1';
const RAW = `courses/${COURSE}/preview/uploads/abc.mp4`;

const call = (groups: string[] = ['instructor'], cookies: string[] = []) =>
  callerFor(router, { sub: SUB, groups, responseCookies: cookies });

const conditionalCheckFailed = () =>
  Object.assign(new Error('conditional'), {
    cause: Object.assign(new Error('conditional'), {
      name: 'ConditionalCheckFailedException',
    }),
  });

const record = (overrides: Record<string, unknown> = {}) => ({
  courseId: COURSE,
  status: 'ready',
  s3Key: `courses/${COURSE}/preview/nonce-1/master.m3u8`,
  submissionNonce: 'nonce-1',
  durationSeconds: 60,
  uploadedBy: SUB,
  ...overrides,
});

const storedPreview = (data: unknown) =>
  previewGet.mockReturnValue({ go: vi.fn().mockResolvedValue({ data }) });

beforeEach(() => {
  vi.clearAllMocks();
  courseInstructorGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: { courseId: COURSE } }),
  });
  getSignedUrl.mockResolvedValue('https://upload.test/put');
  getVideoUploadETag.mockResolvedValue('"etag-1"');
  submitTranscodeJob.mockResolvedValue('job-1');
  getSignedCloudFrontCookies.mockResolvedValue(['cookie=1']);
  previewCreate.mockReturnValue({ go: vi.fn().mockResolvedValue({}) });
  previewPatchGo.mockResolvedValue({});
  previewPatchWhere.mockReturnValue({ go: previewPatchGo });
  previewPatchRemove.mockReturnValue({ where: previewPatchWhere });
  previewPatchSet.mockReturnValue({
    remove: previewPatchRemove,
    where: previewPatchWhere,
  });
  previewPatch.mockReturnValue({ set: previewPatchSet });
  previewDeleteGo.mockResolvedValue({ data: record() });
  previewDeleteWhere.mockReturnValue({ go: previewDeleteGo });
  previewDelete.mockReturnValue({ where: previewDeleteWhere });
  storedPreview(record({ status: 'processing' }));
});

describe.each([
  [
    'createUploadUrl',
    (c: any) => c.createUploadUrl({ courseId: COURSE, fileName: 'a.mp4' }),
  ],
  [
    'create',
    (c: any) =>
      c.create({ courseId: COURSE, rawKey: RAW, durationSeconds: 60 }),
  ],
  [
    'replace',
    (c: any) =>
      c.replace({
        courseId: COURSE,
        rawKey: RAW,
        durationSeconds: 60,
        expectedSubmissionNonce: 'nonce-1',
      }),
  ],
  [
    'remove',
    (c: any) =>
      c.remove({ courseId: COURSE, expectedSubmissionNonce: 'nonce-1' }),
  ],
  ['createVideoUrl', (c: any) => c.createVideoUrl({ courseId: COURSE })],
])('%s authorisation', (_name, run) => {
  it('refuses a caller outside the instructor group', async () => {
    await expect(run(call(['student']))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('refuses an instructor who does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });
    await expect(run(call())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(previewCreate).not.toHaveBeenCalled();
    expect(previewPatch).not.toHaveBeenCalled();
    expect(previewDelete).not.toHaveBeenCalled();
  });
});

describe('createUploadUrl', () => {
  it('signs an upload under the course preview uploads folder', async () => {
    const result = await call().createUploadUrl({
      courseId: COURSE,
      fileName: 'Intro.MP4',
    });

    expect(result.uploadUrl).toBe('https://upload.test/put');
    expect(result.objectKey).toMatch(
      new RegExp(`^courses/${COURSE}/preview/uploads/[0-9a-f-]+\\.mp4$`),
    );
  });

  it('refuses a type outside the lesson video allowlist', async () => {
    await expect(
      call().createUploadUrl({ courseId: COURSE, fileName: 'a.exe' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(getSignedUrl).not.toHaveBeenCalled();
  });
});

describe('create', () => {
  it('records a processing preview and submits its transcode job', async () => {
    storedPreview(record({ status: 'processing', mediaConvertJobId: 'job-1' }));

    const result = await call().create({
      courseId: COURSE,
      rawKey: RAW,
      durationSeconds: 60,
    });

    const created = previewCreate.mock.calls[0]![0];
    expect(created).toMatchObject({
      courseId: COURSE,
      status: 'processing',
      durationSeconds: 60,
      uploadedBy: SUB,
      transcodePending: 'pending',
    });
    expect(submitTranscodeJob).toHaveBeenCalledWith({
      target: 'coursePreview',
      courseId: COURSE,
      objectKey: RAW,
      submissionNonce: created.submissionNonce,
    });
    expect(previewPatchSet).toHaveBeenCalledWith({
      mediaConvertJobId: 'job-1',
      rawObjectETag: '"etag-1"',
    });
    expect(result).toMatchObject({
      status: 'processing',
      hasPlayableVersion: false,
    });
    expect(courseUpdate).not.toHaveBeenCalled();
  });

  it('refuses a declared duration over 5 minutes', async () => {
    await expect(
      call().create({ courseId: COURSE, rawKey: RAW, durationSeconds: 301 }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'A preview can be at most 5 minutes long',
    });
    expect(previewCreate).not.toHaveBeenCalled();
  });

  it('refuses a key outside the course upload folder', async () => {
    await expect(
      call().create({
        courseId: COURSE,
        rawKey: 'courses/other/preview/uploads/a.mp4',
        durationSeconds: 60,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses a key that was never uploaded', async () => {
    getVideoUploadETag.mockResolvedValue(undefined);
    await expect(
      call().create({ courseId: COURSE, rawKey: RAW, durationSeconds: 60 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(previewCreate).not.toHaveBeenCalled();
  });

  it('is a CONFLICT when the course already has a preview', async () => {
    previewCreate.mockReturnValue({
      go: vi.fn().mockRejectedValue(conditionalCheckFailed()),
    });
    await expect(
      call().create({ courseId: COURSE, rawKey: RAW, durationSeconds: 60 }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'This course already has a preview',
    });
    expect(submitTranscodeJob).not.toHaveBeenCalled();
  });

  it('leaves exactly one record when two creates race', async () => {
    let created = false;
    previewCreate.mockImplementation(() => ({
      go: async () => {
        if (created) {
          throw conditionalCheckFailed();
        }
        created = true;
        return {};
      },
    }));

    const outcomes = await Promise.allSettled([
      call().create({ courseId: COURSE, rawKey: RAW, durationSeconds: 60 }),
      call().create({ courseId: COURSE, rawKey: RAW, durationSeconds: 60 }),
    ]);

    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(submitTranscodeJob).toHaveBeenCalledTimes(1);
  });

  it('removes the record again when the job cannot be submitted', async () => {
    submitTranscodeJob.mockRejectedValue(new Error('MediaConvert down'));

    await expect(
      call().create({ courseId: COURSE, rawKey: RAW, durationSeconds: 60 }),
    ).rejects.toThrow('MediaConvert down');
    expect(previewDelete).toHaveBeenCalledWith({ courseId: COURSE });
  });
});

describe('replace', () => {
  const input = {
    courseId: COURSE,
    rawKey: RAW,
    durationSeconds: 60,
    expectedSubmissionNonce: 'nonce-1',
  };

  it('keeps the ready version as the previous one while the new one processes', async () => {
    storedPreview(record());

    await call().replace(input);

    const set = previewPatchSet.mock.calls[0]![0];
    expect(set).toMatchObject({
      status: 'processing',
      previousS3Key: `courses/${COURSE}/preview/nonce-1/master.m3u8`,
      transcodePending: 'pending',
      uploadedBy: SUB,
    });
    expect(set.submissionNonce).not.toBe('nonce-1');
    expect(previewPatchRemove).toHaveBeenCalledWith(
      expect.arrayContaining(['s3Key', 'mediaConvertJobId', 'failureReason']),
    );
    expect(submitTranscodeJob).toHaveBeenCalledWith(
      expect.objectContaining({
        target: 'coursePreview',
        submissionNonce: set.submissionNonce,
      }),
    );
    expect(courseUpdate).not.toHaveBeenCalled();
  });

  it('does not change the previous version when replacing a failed attempt', async () => {
    storedPreview(
      record({
        status: 'failed',
        s3Key: undefined,
        failureReason: 'too-long',
        previousS3Key: `courses/${COURSE}/preview/nonce-0/master.m3u8`,
      }),
    );

    await call().replace(input);

    expect(previewPatchSet.mock.calls[0]![0]).not.toHaveProperty(
      'previousS3Key',
    );
  });

  it('is a CONFLICT on a stale expectedSubmissionNonce, writing nothing', async () => {
    storedPreview(record({ submissionNonce: 'nonce-9' }));

    await expect(call().replace(input)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'The preview changed; reload and try again',
    });
    expect(previewPatch).not.toHaveBeenCalled();
    expect(submitTranscodeJob).not.toHaveBeenCalled();
  });

  it('is a CONFLICT when the write loses its race', async () => {
    storedPreview(record());
    previewPatchGo.mockRejectedValueOnce(conditionalCheckFailed());

    await expect(call().replace(input)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'The preview changed; reload and try again',
    });
    expect(submitTranscodeJob).not.toHaveBeenCalled();
  });

  it('refuses a declared duration over 5 minutes', async () => {
    await expect(
      call().replace({ ...input, durationSeconds: 301 }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'A preview can be at most 5 minutes long',
    });
    expect(previewPatch).not.toHaveBeenCalled();
  });

  it('is NOT_FOUND when there is nothing to replace', async () => {
    storedPreview(null);
    await expect(call().replace(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('leaves a retried call alone when the same file is already in flight', async () => {
    storedPreview(
      record({
        status: 'processing',
        s3Key: undefined,
        mediaConvertJobId: 'job-1',
        rawObjectETag: '"etag-1"',
      }),
    );

    await call().replace(input);

    expect(previewPatch).not.toHaveBeenCalled();
    expect(submitTranscodeJob).not.toHaveBeenCalled();
  });

  it('cancels the job of the attempt it supersedes', async () => {
    storedPreview(
      record({
        status: 'processing',
        s3Key: undefined,
        mediaConvertJobId: 'job-old',
        rawObjectETag: '"other"',
      }),
    );

    await call().replace(input);

    expect(bestEffortCancelTranscodeJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        target: 'coursePreview',
        jobId: 'job-old',
        submissionNonce: 'nonce-1',
      }),
    );
  });

  it('marks the attempt failed when the job cannot be submitted', async () => {
    storedPreview(record());
    submitTranscodeJob.mockRejectedValue(new Error('MediaConvert down'));

    await expect(call().replace(input)).rejects.toThrow('MediaConvert down');
    expect(previewPatchSet).toHaveBeenLastCalledWith({
      status: 'failed',
      failureReason: 'transcode-error',
    });
  });
});

describe('remove', () => {
  it('deletes the record and schedules cleanup of every version and raw upload', async () => {
    previewDeleteGo.mockResolvedValue({
      data: record({
        status: 'processing',
        s3Key: undefined,
        previousS3Key: `courses/${COURSE}/preview/nonce-0/master.m3u8`,
        submissionNonce: 'nonce-1',
        mediaConvertJobId: 'job-1',
      }),
    });

    const result = await call().remove({
      courseId: COURSE,
      expectedSubmissionNonce: 'nonce-1',
    });

    expect(result).toEqual({ removed: true });
    expect(previewDelete).toHaveBeenCalledWith({ courseId: COURSE });
    // The played previous version waits out the signed cookies...
    expect(scheduleTranscodeCleanup).toHaveBeenCalledWith(
      expect.anything(),
      { target: 'coursePreview', courseId: COURSE, submissionNonce: 'nonce-0' },
      expect.any(Number),
    );
    // ...and the attempt in flight is cancelled, which schedules its own.
    expect(bestEffortCancelTranscodeJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ jobId: 'job-1', submissionNonce: 'nonce-1' }),
    );
    expect(bestEffortDeletePreviewUploads).toHaveBeenCalledWith(
      expect.anything(),
      COURSE,
    );
    expect(courseUpdate).not.toHaveBeenCalled();
  });

  it('schedules the ready version once', async () => {
    await call().remove({
      courseId: COURSE,
      expectedSubmissionNonce: 'nonce-1',
    });

    expect(scheduleTranscodeCleanup).toHaveBeenCalledTimes(1);
    expect(bestEffortCancelTranscodeJob).not.toHaveBeenCalled();
  });

  it('is a CONFLICT on a stale expectedSubmissionNonce', async () => {
    previewDeleteGo.mockRejectedValue(conditionalCheckFailed());

    await expect(
      call().remove({ courseId: COURSE, expectedSubmissionNonce: 'stale' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'The preview changed; reload and try again',
    });
    expect(scheduleTranscodeCleanup).not.toHaveBeenCalled();
  });
});

describe('createVideoUrl', () => {
  beforeEach(() => {
    courseGet.mockReturnValue({
      go: async () => ({ data: { courseId: COURSE } }),
    });
  });

  it('signs the played version for the instructor, even in a draft course', async () => {
    storedPreview(record());
    const cookies: string[] = [];

    const result = await call(['instructor'], cookies).createVideoUrl({
      courseId: COURSE,
    });

    expect(result.url).toBe(
      `https://media.test/courses/${COURSE}/preview/nonce-1/master.m3u8`,
    );
    expect(result.versionId).toBe('nonce-1');
    expect(getSignedCloudFrontCookies).toHaveBeenCalledWith(
      `courses/${COURSE}/preview/nonce-1/`,
    );
    expect(cookies).toEqual(['cookie=1']);
  });

  it('flags translated tracks as machine-translated', async () => {
    const track = (trackId: string, source: string, isDefault = false) => ({
      trackId,
      nonce: 'nonce-1',
      language: trackId,
      label: trackId,
      isDefault,
      source,
      key: `courses/${COURSE}/preview/nonce-1/captions/${trackId}.vtt`,
    });
    storedPreview(
      record({
        captionTracks: [
          track('en-US', 'auto', true),
          track('es-ES', 'translated'),
        ],
      }),
    );

    const { captions } = await call().createVideoUrl({ courseId: COURSE });

    expect(
      captions.map((c) => [c.language, c.source, c.machineTranslated]),
    ).toEqual([
      ['en-US', 'auto', false],
      ['es-ES', 'translated', true],
    ]);
  });

  it('reports each caption language as translated, failed or translating', async () => {
    const track = (trackId: string, source: string, extra = {}) => ({
      trackId,
      nonce: 'nonce-1',
      language: trackId,
      label: trackId,
      isDefault: trackId === 'en-US',
      source,
      key: `courses/${COURSE}/preview/nonce-1/captions/${trackId}.vtt`,
      ...extra,
    });
    courseGet.mockReturnValue({
      go: async () => ({
        data: {
          courseId: COURSE,
          captionLanguages: ['es-ES', 'fr-FR', 'de-DE'],
        },
      }),
    });
    storedPreview(
      record({
        captionTracks: [
          track('en-US', 'uploaded'),
          track('es-ES', 'translated', { sourceTrackId: 'en-US' }),
        ],
        captionTranslation: {
          sourceTrackId: 'en-US',
          failures: [{ language: 'fr-FR', reason: 'failed' }],
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      }),
    );

    const { translations } = await call().createVideoUrl({ courseId: COURSE });

    expect(translations.map((x) => [x.language, x.state])).toEqual([
      ['es-ES', 'translated'],
      ['fr-FR', 'failed'],
      ['de-DE', 'translating'],
    ]);
  });

  it('plays the previous version while a replacement processes', async () => {
    storedPreview(
      record({
        status: 'processing',
        s3Key: undefined,
        previousS3Key: `courses/${COURSE}/preview/nonce-0/master.m3u8`,
      }),
    );

    const result = await call().createVideoUrl({ courseId: COURSE });

    expect(result.versionId).toBe('nonce-0');
  });

  it('is NOT_FOUND with nothing playable', async () => {
    storedPreview(record({ status: 'processing', s3Key: undefined }));
    await expect(
      call().createVideoUrl({ courseId: COURSE }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    storedPreview(null);
    await expect(
      call().createVideoUrl({ courseId: COURSE }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
