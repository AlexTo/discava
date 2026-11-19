/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { LOCAL_PORTAL_ORIGINS } from '@discava/common-infra-config/local-portals';

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
 * which also stands in for MediaConvert, Transcribe and EventBridge Scheduler (#137):
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

/**
 * The Stripe stand-in, part of the event runner (packages/events,
 * `src/local/stripe-stand-in.ts`): backend code points the `stripe` SDK at it
 * whenever `isLocalDev()`, as S3 is pointed at S3Mock. Its two accounts are
 * documented here for tests and the quickstart only: no backend code reads
 * them as credentials. An administrator connects one through admin-api like
 * any other key, and the key then lives in the local secrets store
 * (`stripe/secrets-store.ts`), never in a constant.
 */
export const LOCAL_STRIPE = {
  protocol: 'http' as const,
  host: LOCAL_HOST,
  port: LOCAL_EVENT_RUNNER.port,
  accounts: {
    sk_test_local: { accountId: 'acct_local', name: 'Local Stripe Account' },
    sk_test_local_2: {
      accountId: 'acct_local_2',
      name: 'Second Local Stripe Account',
    },
  } as Record<string, { accountId: string; name: string }>,
  /** A restricted key without permission to manage webhook endpoints. */
  restrictedKeyWithoutWebhooks: 'rk_test_local_nowebhook',
};

/**
 * How long a checkout lives, in seconds, instead of an hour: a positive
 * integer in `LOCAL_CHECKOUT_TTL_SECONDS`, honoured only in local dev, so a
 * contributor and the e2e switch scenario need not wait out the open-checkout
 * window. `undefined` when unset, invalid or deployed.
 */
export const localCheckoutTtlSeconds = (): number | undefined => {
  if (!isLocalDev()) return undefined;
  const raw = process.env.LOCAL_CHECKOUT_TTL_SECONDS;
  if (raw === undefined || !/^[1-9]\d*$/.test(raw)) return undefined;
  const seconds = Number(raw);
  return Number.isSafeInteger(seconds) ? seconds : undefined;
};

/**
 * ElasticMQ, which stands in for SQS in local dev: the queues local dev's
 * stream router and feature runners use. Each registered stream feature
 * (core-table's `STREAM_FEATURES`) has a queue and a failure queue named from
 * its registration name, and the router has a failure queue of its own for
 * records it can't send. ElasticMQ keeps messages in memory, so a restart
 * empties them. `endpoint`, `region` and the dummy credentials are what the
 * SQS client uses against it.
 */
export const LOCAL_QUEUES = {
  port: 9324,
  endpoint: `http://${LOCAL_HOST}:9324`,
  region: 'us-east-1',
  accountId: '000000000000',
  // Pinned (the tag is a multi-arch manifest list); see the stream event
  // router's research.md, R-2.
  image: 'softwaremill/elasticmq:1.7.1',
  containerName: 'discava-elasticmq',
  routerFailureQueue: 'stream-router-failures',
  // Longer than a feature's 5 s batch window, so a batch being gathered isn't
  // received a second time, and short enough that retries finish quickly.
  visibilityTimeoutSeconds: 10,
};

/** The local queue holding a stream feature's messages. */
export const localFeatureQueueName = (feature: string): string =>
  `stream-${feature}`;

/** The local failure queue a stream feature's messages move to. */
export const localFeatureFailureQueueName = (feature: string): string =>
  `stream-${feature}-failures`;

/** The URL of a local queue, which the SQS client addresses it by. */
export const localQueueUrl = (queueName: string): string =>
  `${LOCAL_QUEUES.endpoint}/${LOCAL_QUEUES.accountId}/${queueName}`;

/** SQS client settings for the local queue service; empty when deployed. */
export const sqsClientConfig = (): {
  endpoint?: string;
  region?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
} =>
  isLocalDev()
    ? {
        endpoint: LOCAL_QUEUES.endpoint,
        region: LOCAL_QUEUES.region,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }
    : {};

/** What submitTranscodeJob asks the event runner to transcode, in local dev. */
export interface LocalTranscodeJobRequest {
  /** The raw upload, in the lesson media upload bucket. */
  inputKey: string;
  /** Where its HLS goes in the lesson media bucket, ending in `/`. */
  outputPrefix: string;
  /** As MediaConvert's UserMetadata, carried into the completion event. */
  userMetadata: Record<string, string>;
}

/** What startCaptionJob asks the event runner to transcribe, in local dev. */
export interface LocalTranscriptionJobRequest {
  jobName: string;
  /** As the Transcribe job's tags: the ids transcribe-complete looks up. */
  tags: Record<string, string>;
  /** Where the WebVTT goes: the lesson media bucket's local stand-in. */
  outputBucket: string;
  /** Ending in `/`; the file is `<outputKey><jobName>.vtt`. */
  outputKey: string;
}

/** A transcode cleanup to run later, in local dev, with Scheduler's payload. */
export interface LocalScheduleRequest {
  payload: Record<string, string>;
  /** How long to wait, instead of `LOCAL_EVENT_RUNNER.cleanupDelaySeconds`. */
  delaySeconds?: number;
}

/** What sendEmail posts to the event runner's local inbox, in local dev. */
export interface LocalEmailRequest {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

/**
 * Where local dev's portals and core-api listen, for the links in notification
 * emails. Deployed, the stacks set these through environment variables.
 */
export const LOCAL_PORTAL_URLS = LOCAL_PORTAL_ORIGINS;
export const LOCAL_CORE_API_URL = 'http://localhost:2022';

/** The sender local dev's notification emails come from, so email counts as configured. */
export const LOCAL_NOTIFICATIONS_FROM = 'notifications@discava.local';

/** The unsubscribe-token secret in local dev, where there is no Secrets Manager. */
export const LOCAL_UNSUBSCRIBE_SECRET = 'local-dev-unsubscribe-secret';

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
