/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  CONTENT_ITEM_ID,
  COURSE_ID,
  contentItem,
  contentItemGet,
  courseGet,
  courseInstructorGet,
  INSTRUCTOR_SUB,
  installDefaults,
  LESSON_ID,
  MODULE_ID,
} from './content-item-video.fixtures.js';
import { createContentItemVideoUrl } from './content-item-video.js';

const {
  mockModule,
  getSignedUrl,
  s3Send,
  resolveLessonMediaUploadBucketName,
  bestEffortDeleteContentItemVideos,
  getSignedCloudFrontCookies,
  getCloudFrontVideoUrl,
  submitTranscodeJob,
  bestEffortCancelTranscodeJob,
  bestEffortCancelTranscodeJobs,
  getVideoUploadETag,
} = await vi.hoisted(
  async () => (await import('./content-item-video.fixtures.js')).spies,
);

vi.mock('@discava/core-table', async (importOriginal) =>
  mockModule(await importOriginal()),
);

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
  DeleteObjectCommand: vi.fn(function (input) {
    return input;
  }),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl,
}));

// bestEffortDeleteContentItemVideos's own error-swallowing/bucket-selection
// behavior is covered directly in helpers/s3-client.test.ts; here it's just a
// mock so these tests can assert content-item-video.ts calls it correctly.
vi.mock('@discava/common-server-utils/lesson-media-bucket', () => ({
  getS3Client: () => ({ send: s3Send }),
  resolveLessonMediaUploadBucketName,
}));

vi.mock('../helpers/s3-client.js', () => ({
  bestEffortDeleteContentItemVideos,
  bestEffortRetirePreviousVersions: vi.fn(async () => {}),
  getVideoUploadETag,
}));

// getSignedCloudFrontCookies/getCloudFrontVideoUrl's own config-resolution/
// signing behavior is covered directly in @discava/common-server-utils's lesson-media.test.ts;
// here they're just mocks so these tests can assert createContentItemVideoUrl
// calls them correctly.
vi.mock('@discava/common-server-utils/lesson-media', () => ({
  getSignedCloudFrontCookies,
  getCloudFrontVideoUrl,
}));

// submitTranscodeJob's own MediaConvert-request-shape behavior is covered
// directly in helpers/mediaconvert-client.test.ts; here it's just a mock so
// these tests can assert create/updateContentItemVideo call it correctly.
vi.mock('../helpers/mediaconvert-client.js', () => ({
  submitTranscodeJob,
  bestEffortCancelTranscodeJob,
  bestEffortCancelTranscodeJobs,
}));

const router = t.router({
  createContentItemVideoUrl,
});

const callAs = (groups: string[] = ['instructor']) =>
  callerFor(router, { sub: INSTRUCTOR_SUB, groups });

beforeEach(installDefaults);

describe('createContentItemVideoUrl', () => {
  const input = {
    courseId: COURSE_ID,
    moduleId: MODULE_ID,
    lessonId: LESSON_ID,
    contentItemId: CONTENT_ITEM_ID,
  };

  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).createContentItemVideoUrl(input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the content item does not exist', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().createContentItemVideoUrl(input),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(getSignedCloudFrontCookies).not.toHaveBeenCalled();
  });

  it('returns only a plain playback URL, with the signed cookies on the response context', async () => {
    const responseCookies: string[] = [];
    const result = await callerFor(router, {
      sub: INSTRUCTOR_SUB,
      groups: ['instructor'],
      responseCookies,
    }).createContentItemVideoUrl(input);
    const expectedPrefix = contentItem.s3Key.slice(
      0,
      contentItem.s3Key.lastIndexOf('/') + 1,
    );
    expect(getSignedCloudFrontCookies).toHaveBeenCalledWith(expectedPrefix);
    expect(getCloudFrontVideoUrl).toHaveBeenCalledWith(contentItem.s3Key);
    // The cookies are HttpOnly: they must never appear in the JSON body.
    expect(result).toEqual({
      url: 'https://example.cloudfront.net/plain-url',
      withCredentials: true,
      versionId: '',
      captions: [],
      translations: [],
    });
    expect(responseCookies).toEqual([
      'CloudFront-Policy=fake; Domain=example.com',
    ]);
  });

  describe('translations', () => {
    const folder = `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/${CONTENT_ITEM_ID}`;
    const track = (language: string, extra = {}) => ({
      trackId: `track-${language}`,
      nonce: 'n1',
      language,
      label: language,
      source: 'uploaded' as const,
      key: `${folder}/n1/captions/track-${language}.vtt`,
      isDefault: false,
      ...extra,
    });

    it('reports translated, failed and translating languages', async () => {
      courseGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: { captionLanguages: ['es-ES', 'fr-FR', 'de-DE'] },
        }),
      });
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: {
            ...contentItem,
            s3Key: `${folder}/n1/master.m3u8`,
            captionTracks: [
              track('en-US', { isDefault: true }),
              track('es-ES', {
                source: 'translated',
                sourceTrackId: 'track-en-US',
              }),
            ],
            captionTranslation: {
              sourceTrackId: 'track-en-US',
              failures: [{ language: 'fr-FR', reason: 'failed' }],
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        }),
      });

      const { translations } = await callAs().createContentItemVideoUrl(input);

      expect(translations.map((x) => [x.language, x.state])).toEqual([
        ['es-ES', 'translated'],
        ['fr-FR', 'failed'],
        ['de-DE', 'translating'],
      ]);
    });
  });

  describe('captions', () => {
    const folder = `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/${CONTENT_ITEM_ID}`;
    const track = (language: string, extra = {}) => ({
      trackId: `track-${language}`,
      nonce: 'n1',
      language,
      label: language,
      source: 'uploaded' as const,
      key: `${folder}/n1/captions/track-${language}.vtt`,
      isDefault: false,
      ...extra,
    });
    const withCaptions = (extra: object) =>
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: {
            ...contentItem,
            s3Key: `${folder}/n1/master.m3u8`,
            ...extra,
          },
        }),
      });

    beforeEach(() => {
      getCloudFrontVideoUrl.mockImplementation(
        async (key: string) => `https://example.cloudfront.net/${key}`,
      );
    });

    it('lists the played version’s tracks, default first, with source and URL', async () => {
      withCaptions({
        captionTracks: [
          track('es-ES', { source: 'translated' }),
          track('fr-FR', { nonce: 'old' }),
          track('en-US', { isDefault: true, source: 'auto' }),
        ],
        captionTracksRev: 4,
        captionsStatus: 'ready',
      });

      const result = await callAs().createContentItemVideoUrl(input);

      expect(result.versionId).toBe('n1');
      expect(result.captionsStatus).toBe('ready');
      expect(result.captions).toEqual([
        {
          trackId: 'track-en-US',
          language: 'en-US',
          label: 'en-US',
          isDefault: true,
          source: 'auto',
          machineTranslated: false,
          url: `https://example.cloudfront.net/${folder}/n1/captions/track-en-US.vtt`,
        },
        {
          trackId: 'track-es-ES',
          language: 'es-ES',
          label: 'es-ES',
          isDefault: false,
          source: 'translated',
          machineTranslated: true,
          url: `https://example.cloudfront.net/${folder}/n1/captions/track-es-ES.vtt`,
        },
      ]);
    });

    it('returns no S3 key and no revision', async () => {
      withCaptions({
        captionTracks: [track('en-US', { isDefault: true })],
        captionTracksRev: 4,
      });

      const result = await callAs().createContentItemVideoUrl(input);

      const body = JSON.stringify(result);
      expect(body).not.toContain('captionTracksRev');
      expect(body).not.toContain('"key"');
      expect(result.captions[0]).not.toHaveProperty('key');
    });

    it('reports a pending status older than two hours as failed', async () => {
      withCaptions({
        captionsStatus: 'pending',
        captionsPendingSince: new Date(
          Date.now() - 3 * 3_600_000,
        ).toISOString(),
      });
      await expect(
        callAs().createContentItemVideoUrl(input),
      ).resolves.toMatchObject({ captionsStatus: 'failed' });
    });

    it('reports a recent pending status as pending', async () => {
      withCaptions({
        captionsStatus: 'pending',
        captionsPendingSince: new Date().toISOString(),
      });
      await expect(
        callAs().createContentItemVideoUrl(input),
      ).resolves.toMatchObject({ captionsStatus: 'pending' });
    });
  });

  it.each(['pending', 'failed'] as const)(
    'throws NOT_FOUND when the content item status is %s',
    async (status) => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({ data: { ...contentItem, status } }),
      });

      await expect(
        callAs().createContentItemVideoUrl(input),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(getSignedCloudFrontCookies).not.toHaveBeenCalled();
    },
  );
});
