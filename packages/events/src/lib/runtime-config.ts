/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getAppConfig } from '@aws-lambda-powertools/parameters/appconfig';
import {
  isLocalDev,
  localBucketName,
} from '@discava/common-server-utils/local-dev';

type S3Config = {
  bucketName: string;
};

const resolveAppConfigValue = (() => {
  const cache = new Map<string, unknown>();
  return async <T>(namespace: string, key: string): Promise<T> => {
    const cacheKey = `${namespace}.${key}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      return cached as T;
    }
    const appId = process.env.RUNTIME_CONFIG_APP_ID;
    if (!appId) {
      throw new Error('RUNTIME_CONFIG_APP_ID environment variable is not set');
    }
    const config = await getAppConfig<{ [k: string]: T | undefined }>(
      namespace,
      {
        application: appId,
        environment: 'default',
        transform: 'json',
      },
    );
    const value = config?.[key];
    if (!value) {
      throw new Error(
        `Could not resolve ${namespace}.${key} from runtime config`,
      );
    }
    cache.set(cacheKey, value);
    return value;
  };
})();

// A bucket's name: the stack's from AppConfig when deployed, or the S3Mock
// bucket standing in for it in local dev (#137).
const resolveBucketName = async (runtimeConfigKey: string): Promise<string> =>
  isLocalDev()
    ? localBucketName(runtimeConfigKey)
    : (await resolveAppConfigValue<S3Config>('s3', runtimeConfigKey))
        .bucketName;

export const resolveLessonMediaUploadBucketName = (): Promise<string> =>
  resolveBucketName('LessonMediaUploadBucket');

export const resolveLessonMediaBucketName = (): Promise<string> =>
  resolveBucketName('LessonMediaBucket');

type TranscodeCleanupConfig = {
  lambdaArn: string;
  schedulerRoleArn: string;
  scheduleGroupName: string;
};

// Published once by application-stack.ts alongside the transcode-cleanup
// Lambda itself -- same config instructor-api's own scheduler reads.
export const resolveTranscodeCleanupConfig =
  (): Promise<TranscodeCleanupConfig> =>
    resolveAppConfigValue<TranscodeCleanupConfig>(
      'mediaConvert',
      'TranscodeCleanup',
    );
