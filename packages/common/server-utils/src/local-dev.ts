/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/** Whether this is a local dev server (`nx dev`), rather than a deployed Lambda. */
export const isLocalDev = (): boolean => process.env.LOCAL_DEV === 'true';

/**
 * The host local dev's servers reach its Docker services (DynamoDB local,
 * S3Mock) and the event runner on. IPv4 explicitly: Docker publishes on it,
 * and `localhost` can resolve to ::1 first, reaching whatever else on the
 * machine listens on [::1] at the same port (another project's dev server,
 * say) instead.
 */
export const LOCAL_HOST = '127.0.0.1';

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
        endpoint: `http://${LOCAL_HOST}:${LOCAL_S3.port}`,
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

/**
 * An object's URL in local dev, served straight from S3Mock: no CloudFront
 * and no signing, so whatever plays it mustn't send credentials (S3Mock's
 * CORS answers `*`, which browsers refuse for credentialed requests).
 */
export const localObjectUrl = (runtimeConfigKey: string, key: string): string =>
  `http://localhost:${LOCAL_S3.port}/${localBucketName(runtimeConfigKey)}/${key}`;

/**
 * Local dev's event runner (packages/events, `src/local/event-runner.ts`),
 * which also stands in for MediaConvert and EventBridge Scheduler (#137):
 * instructor-api and the event handlers call it instead of those services
 * in local dev.
 */
export const LOCAL_EVENT_RUNNER = {
  port: 2024,
  // How long a scheduled transcode cleanup waits locally. Deployed, it waits
  // out a canceled job's write tail or students' CloudFront cookies (up to
  // hours); locally nothing writes late and there are no cookies.
  cleanupDelaySeconds: 60,
};

/** What submitTranscodeJob asks the event runner to transcode, in local dev. */
export interface LocalTranscodeJobRequest {
  /** The raw upload, in the lesson media upload bucket. */
  inputKey: string;
  /** Where its HLS goes in the lesson media bucket, ending in `/`. */
  outputPrefix: string;
  /** As MediaConvert's UserMetadata, carried into the completion event. */
  userMetadata: Record<string, string>;
}

/** A transcode cleanup to run later, in local dev, with Scheduler's payload. */
export interface LocalScheduleRequest {
  payload: Record<string, string>;
}

/**
 * Calls the local event runner, throwing if it's not running or refuses.
 * Returns its JSON response, if any.
 */
export const callLocalEventRunner = async <T = unknown>(
  method: 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T | undefined> => {
  const url = `http://${LOCAL_HOST}:${LOCAL_EVENT_RUNNER.port}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      ...(body !== undefined && {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });
  } catch (cause) {
    throw new Error(
      `The local event runner isn't reachable at ${url}; is @discava/events:dev running?`,
      { cause },
    );
  }
  if (!response.ok) {
    throw new Error(
      `The local event runner refused ${method} ${path}: ${response.status} ${await response.text()}`,
    );
  }
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : undefined;
};

/**
 * The OIDC server local dev signs in with instead of Cognito (#226):
 * navikt/mock-oauth2-server, with a login page offering the local test users
 * (common/scripts/src/oidc/login.html). The portals' local-dev runtime config
 * points `localOidc` at `http://localhost:<port>/<issuer>` with `clientId`, to
 * match. Cognito itself is only exercised on a deployed stage.
 */
export const LOCAL_OIDC = {
  port: 9400,
  // Pinned, at least 2 weeks old when chosen (see #226 for why this one).
  image: 'ghcr.io/navikt/mock-oauth2-server:6.0.4',
  containerName: 'discava-oidc',
  issuer: 'discava',
  clientId: 'local',
};
