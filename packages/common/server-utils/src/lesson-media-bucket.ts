/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Logger } from '@aws-lambda-powertools/logger';
import { getAppConfig } from '@aws-lambda-powertools/parameters/appconfig';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { isLocalDev, localBucketName, s3ClientConfig } from './local-dev.js';

/**
 * Resolves and caches a single key within a RuntimeConfig/AppConfig
 * namespace (e.g. namespace `s3`, key `LessonMediaBucket`). Shared by every
 * Lambda that reads the stack's runtime config.
 */
export const resolveAppConfigValue = (() => {
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

let _client: S3Client | undefined;

export const getS3Client = (): S3Client => {
  if (!_client) {
    // S3Mock in local dev (#137).
    _client = new S3Client(s3ClientConfig());
  }
  return _client;
};

type S3Config = {
  bucketName: string;
};

// A bucket's name, from its runtime config key: the stack's bucket from
// AppConfig when deployed, or the S3Mock bucket standing in for it in local
// dev (#137).
export const resolveBucketName = async (
  runtimeConfigKey: string,
): Promise<string> =>
  isLocalDev()
    ? localBucketName(runtimeConfigKey)
    : (await resolveAppConfigValue<S3Config>('s3', runtimeConfigKey))
        .bucketName;

export const resolveLessonMediaBucketName = (): Promise<string> =>
  resolveBucketName('LessonMediaBucket');

// The raw, untranscoded upload -- never served directly, see decision log
// in #110. Video and file uploads target this bucket instead of
// LessonMediaBucket, and are copied over once saved.
export const resolveLessonMediaUploadBucketName = (): Promise<string> =>
  resolveBucketName('LessonMediaUploadBucket');

// S3 hard caps: ListObjectsV2 returns at most 1,000 keys per page, and
// DeleteObjects accepts at most 1,000 keys per call (a bigger request is
// rejected outright, not partially applied).
const S3_PAGE_SIZE = 1000;

export const listAllObjectKeys = async (
  logger: Logger | undefined,
  bucket: string,
  prefix: string,
): Promise<string[]> => {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    try {
      const { Contents, IsTruncated, NextContinuationToken } =
        await getS3Client().send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );
      for (const object of Contents ?? []) {
        if (object.Key !== undefined) {
          keys.push(object.Key);
        }
      }
      continuationToken = IsTruncated ? NextContinuationToken : undefined;
    } catch (error) {
      logger?.error('Failed to list lesson media objects from S3', {
        error,
        bucket,
        prefix,
      });
      break;
    }
  } while (continuationToken !== undefined);
  return keys;
};

export const deleteObjectsInBatches = async (
  logger: Logger | undefined,
  bucket: string,
  keys: readonly string[],
): Promise<void> => {
  for (let i = 0; i < keys.length; i += S3_PAGE_SIZE) {
    const batch = keys.slice(i, i + S3_PAGE_SIZE);
    try {
      const { Errors } = await getS3Client().send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })) },
        }),
      );
      // DeleteObjects can resolve successfully and still fail individual
      // keys -- doesn't throw, so has to be checked explicitly or it's
      // silently lost. Logged, not thrown: this function is best-effort
      // by contract (see bestEffortDeleteContentItemVideos's docstring).
      if (Errors && Errors.length > 0) {
        logger?.error('Failed to delete some lesson media objects from S3', {
          bucket,
          errors: Errors,
        });
      }
    } catch (error) {
      logger?.error('Failed to delete lesson media objects from S3', {
        error,
        bucket,
        keys: batch,
      });
    }
  }
};
