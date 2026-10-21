/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/** Whether this is a local dev server (`nx dev`), rather than a deployed Lambda. */
export const isLocalDev = (): boolean => process.env.LOCAL_DEV === 'true';

/**
 * S3Mock, which stands in for S3 in local dev (#137): its container, and the
 * local bucket for each bucket's runtime config key. Objects are kept in a
 * named volume, so they survive restarts like DynamoDB local's data.
 * The portals' local-dev runtime config points public media at
 * `http://localhost:<port>/<PublicMediaBucket>/` to match.
 */
export const LOCAL_S3 = {
  port: 9090,
  // Pinned, at least 2 weeks old when chosen (see #137 for why S3Mock).
  image: 'adobe/s3mock:5.2.3',
  containerName: 'discava-s3mock',
  buckets: {
    LessonMediaBucket: 'discava-lesson-media',
    LessonMediaUploadBucket: 'discava-lesson-media-upload',
    PublicMediaBucket: 'discava-public-media',
  } as Record<string, string>,
};

/**
 * S3 client settings: S3Mock in local dev, the Lambda's own defaults
 * otherwise. S3Mock needs path-style URLs (no per-bucket hostnames on
 * localhost) and accepts any credentials.
 */
export const s3ClientConfig = (): {
  endpoint?: string;
  forcePathStyle?: boolean;
  region?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
} =>
  isLocalDev()
    ? {
        endpoint: `http://localhost:${LOCAL_S3.port}`,
        forcePathStyle: true,
        region: 'us-east-1',
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }
    : {};

/** The local bucket standing in for `runtimeConfigKey`'s bucket in local dev. */
export const localBucketName = (runtimeConfigKey: string): string => {
  const bucket = LOCAL_S3.buckets[runtimeConfigKey];
  if (!bucket) {
    throw new Error(`No local bucket for ${runtimeConfigKey} (see LOCAL_S3)`);
  }
  return bucket;
};
