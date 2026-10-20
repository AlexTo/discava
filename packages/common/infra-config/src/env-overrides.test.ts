/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'vitest';
import { applyEnvOverrides } from './env-overrides.js';
import type { StageConfig } from './stages.types.js';

const STAGE = 'discava-test-stage';

const ENV_KEYS = [
  'DISCAVA_TEST_STAGE_REGION',
  'DISCAVA_TEST_STAGE_ACCOUNT',
  'DISCAVA_TEST_STAGE_INFRA_STUDENT_PORTAL_ENABLE_WAF',
  'DISCAVA_TEST_STAGE_INFRA_STUDENT_PORTAL_DOMAIN_NAMES',
  'DISCAVA_TEST_STAGE_INFRA_STUDENT_PORTAL_CERTIFICATE_ARN',
  'DISCAVA_TEST_STAGE_INFRA_CORE_API_ENABLE_WAF',
  'DISCAVA_TEST_STAGE_INFRA_CORE_API_DOMAIN_NAME',
  'DISCAVA_TEST_STAGE_INFRA_CORE_API_CERTIFICATE_ARN',
  'DISCAVA_TEST_STAGE_INFRA_INSTRUCTOR_PORTAL_DOMAIN_NAMES',
  'DISCAVA_TEST_STAGE_INFRA_ADMIN_PORTAL_CERTIFICATE_ARN',
  'DISCAVA_TEST_STAGE_INFRA_LESSON_MEDIA_DOMAIN_NAMES',
  'DISCAVA_TEST_STAGE_INFRA_UNKNOWN_FIELD',
  'DISCAVA_TEST_STAGE_INFRA_CORE_API_THROTTLE_RATE_LIMIT',
  'DISCAVA_TEST_STAGE_INFRA_CORE_API_LOG_LEVEL',
  'DISCAVA_TEST_STAGE_INFRA_INSTRUCTOR_API_RESERVED_CONCURRENCY',
  'DISCAVA_TEST_STAGE_INFRA_CORE_TABLE_MAX_READ_REQUEST_UNITS',
  'DISCAVA_TEST_STAGE_INFRA_IDENTITY_ENABLE_SELF_SIGN_UP',
];

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('applyEnvOverrides', () => {
  it('returns base config unchanged when no override env vars are set', () => {
    const base: StageConfig = {
      region: 'ap-southeast-2',
      infra: { studentPortal: { enableWaf: true } },
    };

    expect(applyEnvOverrides(STAGE, base)).toEqual(base);
  });

  it('ignores unrelated env vars', () => {
    process.env.DISCAVA_TEST_STAGE_INFRA_UNKNOWN_FIELD = 'true';
    const base: StageConfig = {};

    expect(applyEnvOverrides(STAGE, base)).toEqual({});
  });

  it('overrides a boolean component field, taking priority over the base value', () => {
    process.env.DISCAVA_TEST_STAGE_INFRA_STUDENT_PORTAL_ENABLE_WAF = 'false';
    const base: StageConfig = {
      infra: { studentPortal: { enableWaf: true } },
    };

    expect(applyEnvOverrides(STAGE, base)).toEqual({
      infra: { studentPortal: { enableWaf: false } },
    });
  });

  it('throws a clear error for an invalid boolean value', () => {
    process.env.DISCAVA_TEST_STAGE_INFRA_CORE_API_ENABLE_WAF = 'nope';

    expect(() => applyEnvOverrides(STAGE, {})).toThrow(
      /DISCAVA_TEST_STAGE_INFRA_CORE_API_ENABLE_WAF/,
    );
  });

  it('overrides the limit settings: numbers, log levels and self sign-up', () => {
    process.env.DISCAVA_TEST_STAGE_INFRA_CORE_API_THROTTLE_RATE_LIMIT = ' 25 ';
    process.env.DISCAVA_TEST_STAGE_INFRA_CORE_API_LOG_LEVEL = 'WARN';
    process.env.DISCAVA_TEST_STAGE_INFRA_INSTRUCTOR_API_RESERVED_CONCURRENCY =
      '5';
    process.env.DISCAVA_TEST_STAGE_INFRA_CORE_TABLE_MAX_READ_REQUEST_UNITS =
      '100';
    process.env.DISCAVA_TEST_STAGE_INFRA_IDENTITY_ENABLE_SELF_SIGN_UP = 'false';

    expect(
      applyEnvOverrides(STAGE, {
        infra: { coreApi: { throttleRateLimit: 100, enableTracing: false } },
      }),
    ).toEqual({
      infra: {
        coreApi: {
          throttleRateLimit: 25,
          logLevel: 'WARN',
          enableTracing: false,
        },
        instructorApi: { reservedConcurrency: 5 },
        coreTable: { maxReadRequestUnits: 100 },
        identity: { enableSelfSignUp: false },
      },
    });
  });

  it.each([
    [
      'a negative number',
      'DISCAVA_TEST_STAGE_INFRA_CORE_API_THROTTLE_RATE_LIMIT',
      '-5',
    ],
    [
      'a fraction',
      'DISCAVA_TEST_STAGE_INFRA_CORE_API_THROTTLE_RATE_LIMIT',
      '2.5',
    ],
    [
      'not a number',
      'DISCAVA_TEST_STAGE_INFRA_CORE_TABLE_MAX_READ_REQUEST_UNITS',
      'lots',
    ],
    [
      'an unknown log level',
      'DISCAVA_TEST_STAGE_INFRA_CORE_API_LOG_LEVEL',
      'verbose',
    ],
  ])('throws a clear error for %s', (_, key, value) => {
    process.env[key] = value;

    expect(() => applyEnvOverrides(STAGE, {})).toThrow(new RegExp(key));
  });

  it('overrides a string[] field as a comma-separated, trimmed list', () => {
    process.env.DISCAVA_TEST_STAGE_INFRA_STUDENT_PORTAL_DOMAIN_NAMES =
      'learn.example.com, www.learn.example.com ,,';

    expect(applyEnvOverrides(STAGE, {})).toEqual({
      infra: {
        studentPortal: {
          domainNames: ['learn.example.com', 'www.learn.example.com'],
        },
      },
    });
  });

  it('overrides a string field', () => {
    const arn = 'arn:aws:acm:us-east-1:123456789012:certificate/abc-123';
    process.env.DISCAVA_TEST_STAGE_INFRA_STUDENT_PORTAL_CERTIFICATE_ARN = arn;

    expect(applyEnvOverrides(STAGE, {})).toEqual({
      infra: { studentPortal: { certificateArn: arn } },
    });
  });

  it('overrides top-level region and account', () => {
    process.env.DISCAVA_TEST_STAGE_REGION = 'us-east-1';
    process.env.DISCAVA_TEST_STAGE_ACCOUNT = 'test-account-id';

    expect(applyEnvOverrides(STAGE, {})).toEqual({
      region: 'us-east-1',
      account: 'test-account-id',
    });
  });

  it('merges multiple field overrides for the same component alongside unrelated base fields', () => {
    process.env.DISCAVA_TEST_STAGE_INFRA_STUDENT_PORTAL_ENABLE_WAF = 'false';
    process.env.DISCAVA_TEST_STAGE_INFRA_STUDENT_PORTAL_CERTIFICATE_ARN =
      'arn:aws:acm:us-east-1:123456789012:certificate/abc';
    const base: StageConfig = {
      infra: {
        studentPortal: { enableWaf: true, enableKmsEncryption: true },
        coreApi: { enableWaf: true },
      },
    };

    expect(applyEnvOverrides(STAGE, base)).toEqual({
      infra: {
        studentPortal: {
          enableWaf: false,
          enableKmsEncryption: true,
          certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/abc',
        },
        coreApi: { enableWaf: true },
      },
    });
  });

  it('overrides the singular domainName/certificateArn fields on an API component', () => {
    process.env.DISCAVA_TEST_STAGE_INFRA_CORE_API_DOMAIN_NAME =
      'api.example.com';
    process.env.DISCAVA_TEST_STAGE_INFRA_CORE_API_CERTIFICATE_ARN =
      'arn:aws:acm:ap-southeast-2:123456789012:certificate/abc';

    expect(applyEnvOverrides(STAGE, {})).toEqual({
      infra: {
        coreApi: {
          domainName: 'api.example.com',
          certificateArn:
            'arn:aws:acm:ap-southeast-2:123456789012:certificate/abc',
        },
      },
    });
  });

  it('overrides domain/certificate fields on the instructor/admin portals and lesson media bucket', () => {
    process.env.DISCAVA_TEST_STAGE_INFRA_INSTRUCTOR_PORTAL_DOMAIN_NAMES =
      'instruct.example.com';
    process.env.DISCAVA_TEST_STAGE_INFRA_ADMIN_PORTAL_CERTIFICATE_ARN =
      'arn:aws:acm:us-east-1:123456789012:certificate/def';
    process.env.DISCAVA_TEST_STAGE_INFRA_LESSON_MEDIA_DOMAIN_NAMES =
      'media.example.com';

    expect(applyEnvOverrides(STAGE, {})).toEqual({
      infra: {
        instructorPortal: { domainNames: ['instruct.example.com'] },
        adminPortal: {
          certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/def',
        },
        lessonMedia: { domainNames: ['media.example.com'] },
      },
    });
  });
});
