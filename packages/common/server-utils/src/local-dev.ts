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

/** A sign-in to run the pre token generation trigger for, in local dev. */
export interface LocalSignInRequest {
  userName: string;
  /** As Cognito's userAttributes: `sub`, `email`, `given_name`… */
  userAttributes: Record<string, string>;
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

const PROFILE_CLAIMS = ['sub', 'email', 'given_name', 'family_name'] as const;

/**
 * Builds syncLocalUser around how it reaches the event runner (a parameter so
 * tests can stand in for it).
 */
export const createLocalUserSync = (
  signIn: (request: LocalSignInRequest) => Promise<unknown>,
) => {
  // Users already synced (or being synced) by this process, keyed by their
  // profile claims, so a changed name syncs again. Empty on every restart,
  // which only rewrites the same records.
  const synced = new Map<string, Promise<void>>();

  return (claims: Record<string, unknown> | undefined): Promise<void> => {
    if (typeof claims?.sub !== 'string') {
      return Promise.resolve();
    }
    const userAttributes = Object.fromEntries(
      PROFILE_CLAIMS.flatMap((claim) =>
        typeof claims[claim] === 'string' ? [[claim, claims[claim]]] : [],
      ),
    ) as Record<string, string>;
    const key = JSON.stringify(userAttributes);

    let sync = synced.get(key);
    if (!sync) {
      // Shared by the requests a portal sends together after sign-in.
      sync = signIn({
        userName:
          typeof claims.username === 'string' ? claims.username : claims.sub,
        userAttributes,
      }).then(
        () => {},
        (error) => {
          // Tried again on the user's next request; this one goes ahead,
          // as a sign-in does when the deployed trigger's write fails.
          synced.delete(key);
          console.warn(
            `Couldn't sync local user ${claims.sub}: ${(error as Error).message}`,
          );
        },
      );
      synced.set(key, sync);
    }
    return sync;
  };
};

/**
 * Local dev's stand-in for Cognito's pre token generation trigger (#230), which
 * keeps the core table's user records in step when deployed. The local OIDC
 * server has no triggers, so the APIs' local servers call this with each
 * request's token claims, and the first time this process sees a user (or
 * their name changes) it has the event runner run the real trigger handler.
 */
export const syncLocalUser = createLocalUserSync((request) =>
  callLocalEventRunner('POST', '/triggers/pre-token-generation', request),
);
