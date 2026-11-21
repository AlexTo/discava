/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readOptionalSetting,
  readSetting,
  settingEnvName,
} from './settings.js';

describe('settingEnvName', () => {
  it.each([
    ['dynamodb', 'CoreTable', 'DISCAVA_DYNAMODB_CORE_TABLE'],
    ['opensearch', 'Search', 'DISCAVA_OPENSEARCH_SEARCH'],
    ['s3', 'LessonMediaBucket', 'DISCAVA_S3_LESSON_MEDIA_BUCKET'],
    ['s3', 'LessonMediaUploadBucket', 'DISCAVA_S3_LESSON_MEDIA_UPLOAD_BUCKET'],
    ['s3', 'PublicMediaBucket', 'DISCAVA_S3_PUBLIC_MEDIA_BUCKET'],
    [
      'mediaConvert',
      'VideoTranscodePipeline',
      'DISCAVA_MEDIA_CONVERT_VIDEO_TRANSCODE_PIPELINE',
    ],
    [
      'mediaConvert',
      'TranscodeCleanup',
      'DISCAVA_MEDIA_CONVERT_TRANSCODE_CLEANUP',
    ],
    [
      'mediaConvert',
      'CaptionLanguageCode',
      'DISCAVA_MEDIA_CONVERT_CAPTION_LANGUAGE_CODE',
    ],
    ['certificates', 'Reminder', 'DISCAVA_CERTIFICATES_REMINDER'],
    ['captionTranslation', 'Settings', 'DISCAVA_CAPTION_TRANSLATION_SETTINGS'],
  ])('names (%s, %s) %s', (namespace, key, expected) => {
    expect(settingEnvName(namespace, key)).toBe(expected);
  });
});

describe('reading settings', () => {
  const NAME = 'DISCAVA_DYNAMODB_CORE_TABLE';
  afterEach(() => vi.unstubAllEnvs());

  it('parses a present setting', () => {
    vi.stubEnv(NAME, '{"tableName":"t"}');
    expect(readSetting('dynamodb', 'CoreTable')).toEqual({ tableName: 't' });
    expect(readOptionalSetting('dynamodb', 'CoreTable')).toEqual({
      tableName: 't',
    });
  });

  it('parses a string value', () => {
    vi.stubEnv(NAME, '"en-US"');
    expect(readSetting('dynamodb', 'CoreTable')).toBe('en-US');
  });

  it.each([undefined, ''])('treats %j as absent', (value) => {
    if (value === undefined) delete process.env[NAME];
    else vi.stubEnv(NAME, value);
    expect(() => readSetting('dynamodb', 'CoreTable')).toThrow(
      `Missing deploy-time setting ${NAME}`,
    );
    expect(readOptionalSetting('dynamodb', 'CoreTable')).toBeUndefined();
  });

  it('rejects invalid JSON without echoing the value', () => {
    vi.stubEnv(NAME, 'secret-not-json');
    for (const read of [readSetting, readOptionalSetting]) {
      let message = '';
      try {
        read('dynamodb', 'CoreTable');
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toBe(`Invalid deploy-time setting ${NAME}`);
      expect(message).not.toContain('secret');
    }
  });
});
