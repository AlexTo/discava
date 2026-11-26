/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSetting, settingEnvName } from './settings.js';

describe('settingEnvName', () => {
  it.each([
    [
      'dynamodb',
      'CoreTable',
      'tableName',
      'DISCAVA_DYNAMODB_CORE_TABLE_TABLE_NAME',
    ],
    ['opensearch', 'Search', 'endpoint', 'DISCAVA_OPENSEARCH_SEARCH_ENDPOINT'],
    [
      's3',
      'LessonMediaBucket',
      'cloudFrontPrivateKeySecretArn',
      'DISCAVA_S3_LESSON_MEDIA_BUCKET_CLOUD_FRONT_PRIVATE_KEY_SECRET_ARN',
    ],
    [
      'mediaConvert',
      'TranscodeCleanup',
      'scheduleGroupName',
      'DISCAVA_MEDIA_CONVERT_TRANSCODE_CLEANUP_SCHEDULE_GROUP_NAME',
    ],
    [
      'captionTranslation',
      'Settings',
      'maxLanguagesPerCourse',
      'DISCAVA_CAPTION_TRANSLATION_SETTINGS_MAX_LANGUAGES_PER_COURSE',
    ],
  ])('names (%s, %s, %s) %s', (namespace, key, field, expected) => {
    expect(settingEnvName(namespace, key, field)).toBe(expected);
  });

  it('names a setting without a field', () => {
    expect(settingEnvName('s3', 'LessonMediaBucket')).toBe(
      'DISCAVA_S3_LESSON_MEDIA_BUCKET',
    );
  });
});

describe('readSetting', () => {
  const TABLE = 'DISCAVA_DYNAMODB_CORE_TABLE_TABLE_NAME';
  const OTHER = 'DISCAVA_DYNAMODB_CORE_TABLE_OTHER';
  afterEach(() => vi.unstubAllEnvs());

  it('reads each field from its own variable, unparsed', () => {
    vi.stubEnv(TABLE, 'core');
    vi.stubEnv(OTHER, '{"a":1}');
    expect(
      readSetting('dynamodb', 'CoreTable', ['tableName', 'other']),
    ).toEqual({ tableName: 'core', other: '{"a":1}' });
  });

  it.each([undefined, ''])(
    'treats %j as missing, naming the variable',
    (value) => {
      if (value === undefined) delete process.env[TABLE];
      else vi.stubEnv(TABLE, value);
      expect(() => readSetting('dynamodb', 'CoreTable', ['tableName'])).toThrow(
        `Missing deploy-time setting ${TABLE}`,
      );
    },
  );

  it('names the first missing field', () => {
    vi.stubEnv(TABLE, 'core');
    delete process.env[OTHER];
    expect(() =>
      readSetting('dynamodb', 'CoreTable', ['tableName', 'other']),
    ).toThrow(`Missing deploy-time setting ${OTHER}`);
  });

  it('leaves out an optional field that is unset', () => {
    vi.stubEnv(TABLE, 'core');
    delete process.env[OTHER];
    expect(
      readSetting('dynamodb', 'CoreTable', ['tableName'], ['other']),
    ).toEqual({ tableName: 'core' });
    vi.stubEnv(OTHER, 'x');
    expect(
      readSetting('dynamodb', 'CoreTable', ['tableName'], ['other']),
    ).toEqual({ tableName: 'core', other: 'x' });
  });
});
