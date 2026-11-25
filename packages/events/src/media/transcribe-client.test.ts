/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCaptionJob,
  keyFromS3Uri,
  startCaptionJob,
} from './transcribe-client.js';

const { send, isLocalDev, callLocalEventRunner } = vi.hoisted(() => ({
  send: vi.fn(),
  isLocalDev: vi.fn(),
  callLocalEventRunner: vi.fn(),
}));

vi.mock('@aws-sdk/client-transcribe', () => ({
  TranscribeClient: vi.fn(function () {
    return { send };
  }),
  StartTranscriptionJobCommand: vi.fn(function (input) {
    return { type: 'start', input };
  }),
  GetTranscriptionJobCommand: vi.fn(function (input) {
    return { type: 'get', input };
  }),
}));

vi.mock('@discava/common-server-utils/lesson-media-bucket', () => ({
  resolveLessonMediaBucketName: vi.fn(async () => 'media-bucket'),
  resolveLessonMediaUploadBucketName: vi.fn(async () => 'upload-bucket'),
}));

vi.mock('@discava/common-server-utils/local-dev', () => ({
  isLocalDev,
  callLocalEventRunner,
}));

const TARGET = {
  courseId: 'c1',
  moduleId: 'm1',
  lessonId: 'l1',
  contentItemId: 'i1',
  nonce: 'n1',
};
const OUTPUT_KEY =
  'courses/c1/modules/m1/lessons/l1/content-items/i1/transcribe-output/n1/';

beforeEach(() => {
  vi.clearAllMocks();
  isLocalDev.mockReturnValue(false);
  send.mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('startCaptionJob', () => {
  it('starts a job over the audio file, outputting outside the version folder', async () => {
    await startCaptionJob(TARGET);

    expect(send).toHaveBeenCalledWith({
      type: 'start',
      input: {
        TranscriptionJobName: 'captions-i1-n1',
        LanguageCode: 'en-US',
        Media: { MediaFileUri: 's3://upload-bucket/transcribe-input/n1.mp4' },
        OutputBucketName: 'media-bucket',
        OutputKey: OUTPUT_KEY,
        Subtitles: { Formats: ['vtt'] },
        Tags: [
          { Key: 'courseId', Value: 'c1' },
          { Key: 'moduleId', Value: 'm1' },
          { Key: 'lessonId', Value: 'l1' },
          { Key: 'contentItemId', Value: 'i1' },
          { Key: 'nonce', Value: 'n1' },
        ],
      },
    });
  });

  it('uses the language from the setting when there is one', async () => {
    vi.stubEnv('DISCAVA_MEDIA_CONVERT_CAPTION_LANGUAGE_CODE', '"fr-FR"');

    await startCaptionJob(TARGET);

    expect(send.mock.calls[0][0].input.LanguageCode).toBe('fr-FR');
  });

  it('calls the event runner instead in local dev', async () => {
    isLocalDev.mockReturnValue(true);

    await startCaptionJob(TARGET);

    expect(send).not.toHaveBeenCalled();
    expect(callLocalEventRunner).toHaveBeenCalledWith(
      'POST',
      '/transcription-jobs',
      {
        jobName: 'captions-i1-n1',
        tags: expect.objectContaining({ contentItemId: 'i1', nonce: 'n1' }),
        outputBucket: 'media-bucket',
        outputKey: OUTPUT_KEY,
      },
    );
  });

  it('lets a Transcribe failure reach the caller', async () => {
    send.mockRejectedValue(new Error('denied'));

    await expect(startCaptionJob(TARGET)).rejects.toThrow('denied');
  });
});

describe('getCaptionJob', () => {
  const found = (overrides = {}) => ({
    TranscriptionJob: {
      TranscriptionJobStatus: 'COMPLETED',
      Tags: [
        { Key: 'courseId', Value: 'c1' },
        { Key: 'moduleId', Value: 'm1' },
        { Key: 'lessonId', Value: 'l1' },
        { Key: 'contentItemId', Value: 'i1' },
        { Key: 'nonce', Value: 'n1' },
      ],
      Subtitles: {
        SubtitleFileUris: [
          `https://s3.ap-southeast-2.amazonaws.com/media-bucket/${OUTPUT_KEY}captions-i1-n1.vtt`,
        ],
      },
      ...overrides,
    },
  });

  it("returns the job's language", async () => {
    send.mockResolvedValue(found({ LanguageCode: 'fr-FR' }));

    expect((await getCaptionJob('captions-i1-n1')).languageCode).toBe('fr-FR');
  });

  it('returns the tags, status and the VTT key', async () => {
    send.mockResolvedValue(found());

    await expect(getCaptionJob('captions-i1-n1')).resolves.toEqual({
      status: 'COMPLETED',
      ...TARGET,
      vttKey: `${OUTPUT_KEY}captions-i1-n1.vtt`,
      languageCode: 'en-US',
    });
    expect(send.mock.calls[0][0]).toEqual({
      type: 'get',
      input: { TranscriptionJobName: 'captions-i1-n1' },
    });
  });

  it('has no VTT key for a job without subtitles', async () => {
    send.mockResolvedValue(found({ Subtitles: undefined }));

    expect((await getCaptionJob('x')).vttKey).toBeUndefined();
  });

  it('throws for a job missing its tags', async () => {
    send.mockResolvedValue(found({ Tags: [] }));

    await expect(getCaptionJob('x')).rejects.toThrow('missing its tags');
  });
});

describe('keyFromS3Uri', () => {
  it.each([
    ['s3://bucket/a/b.vtt', 'a/b.vtt'],
    ['https://s3.us-east-1.amazonaws.com/bucket/a/b.vtt', 'a/b.vtt'],
    ['https://s3.us-east-1.amazonaws.com/bucket/a%20b.vtt', 'a b.vtt'],
    ['s3://bucket', undefined],
  ])('%s', (uri, key) => {
    expect(keyFromS3Uri(uri)).toBe(key);
  });
});

describe('for a course preview', () => {
  const PREVIEW = {
    target: 'coursePreview' as const,
    courseId: 'c1',
    nonce: 'n1',
  };

  it('starts a job named and tagged for the preview, outputting outside the version folder', async () => {
    await startCaptionJob(PREVIEW);

    expect(send).toHaveBeenCalledWith({
      type: 'start',
      input: expect.objectContaining({
        TranscriptionJobName: 'captions-preview-c1-n1',
        Media: { MediaFileUri: 's3://upload-bucket/transcribe-input/n1.mp4' },
        OutputKey: 'courses/c1/preview/transcribe-output/n1/',
        Tags: [
          { Key: 'target', Value: 'coursePreview' },
          { Key: 'courseId', Value: 'c1' },
          { Key: 'nonce', Value: 'n1' },
        ],
      }),
    });
  });

  it('reads the target back from the job tags', async () => {
    send.mockResolvedValue({
      TranscriptionJob: {
        TranscriptionJobStatus: 'COMPLETED',
        Tags: [
          { Key: 'target', Value: 'coursePreview' },
          { Key: 'courseId', Value: 'c1' },
          { Key: 'nonce', Value: 'n1' },
        ],
      },
    });

    await expect(getCaptionJob('captions-preview-c1-n1')).resolves.toEqual({
      ...PREVIEW,
      status: 'COMPLETED',
      vttKey: undefined,
      languageCode: 'en-US',
    });
  });
});
