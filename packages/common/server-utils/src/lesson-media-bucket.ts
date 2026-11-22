/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Logger } from '@aws-lambda-powertools/logger';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { isLocalDev, localBucketName, s3ClientConfig } from './local-dev.js';
import { readSetting } from './settings.js';

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

// A bucket's name, from its setting key: the stack's bucket from its
// deploy-time setting when deployed, or the S3Mock bucket standing in for it
// in local dev (#137).
export const resolveBucketName = async (
  runtimeConfigKey: string,
): Promise<string> =>
  isLocalDev()
    ? localBucketName(runtimeConfigKey)
    : readSetting<S3Config>('s3', runtimeConfigKey).bucketName;

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
      // keys, so they're checked explicitly. Logged, not thrown: this
      // function is best-effort, like the list above.
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
