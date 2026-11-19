/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Logger } from '@aws-lambda-powertools/logger';
import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBStreamsClient } from '@aws-sdk/client-dynamodb-streams';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import {
  LOCAL_CORE_API_URL,
  LOCAL_EVENT_RUNNER,
  LOCAL_NOTIFICATIONS_FROM,
  LOCAL_PORTAL_URLS,
  LOCAL_QUEUES,
  localBucketName,
  localFeatureFailureQueueName,
  localFeatureQueueName,
  localQueueUrl,
  s3ClientConfig,
  sqsClientConfig,
} from '@discava/common-server-utils/local-dev';
import {
  dynamoDBClientConfig,
  getDynamoDBClient,
  resolveTableName,
  STREAM_FEATURES,
} from '@discava/core-table';
import type { Context, DynamoDBRecord } from 'aws-lambda';
import { syncUserFromPreTokenGenerationEvent } from '../identity/pre-token-generation.js';
import { handler as transcodeCleanup } from '../media/transcode-cleanup.js';
import { handler as transcodeComplete } from '../media/transcode-complete.js';
import { applyTranscribeOutcome } from '../media/transcribe-outcome.js';
import { HANDLERS } from '../router/handlers.js';
import { createSqsQueueClient } from '../router/queue-client.js';
import { createStreamRouter } from '../router/stream-router.js';
import { pollStream } from './dynamodb-stream.js';
import { createEmailInbox } from './email-inbox.js';
import { startEventRunnerServer } from './event-runner-server.js';
import { createFeatureRunner } from './feature-runner.js';
import { createStripeStandIn } from './stripe-stand-in.js';
import { createTranscoder, type Docker } from './transcoder.js';
import { createTranscriber } from './transcriber.js';
import {
  preTokenGenerationEvent,
  transcodeCompletionEvent,
} from './trigger-events.js';
import { waitForQueue } from './wait-for-queue.js';

// Local dev's event runner (#137): what AWS does to trigger the event handlers
// when deployed, done locally, so local changes reach the same handler logic.
// Each trigger gets the event shape it delivers; most call the real exported
// handler. Failures are logged, not retried (the stream features below have
// their own retries and failure queues); AWS's batch bisecting is only on dev.
//
// Triggers:
// - the core table's stream -> the stream router (the deployed router's
//   code, over the same STREAM_FEATURES registry) -> one queue per feature ->
//   one feature runner per feature, which batches by the registration's
//   `batch`, runs its handler (HANDLERS in router/handlers.ts) and retries a
//   failed batch after the queue's visibility timeout, moving a message to
//   the feature's failure queue after its maxReceiveCount receives. The
//   queues are ElasticMQ's (Docker, in memory, so a restart empties them),
//   the one stand-in for SQS. GET /router/queues,
//   POST /router/redrive/<feature> and POST /router/fail/<feature> inspect,
//   replay and fail them. The
//   notification-delivery feature's handler gets its sender and portal URLs
//   from the environment set below, and its emails (sendEmail posts them to
//   POST /emails; the stand-in for SES) are kept in tmp/local-dev/emails/ and
//   shown at GET /inbox
// - a local transcode finishing -> transcode-complete, with the EventBridge
//   event MediaConvert would emit (the transcoder stands in for MediaConvert;
//   instructor-api submits and cancels jobs on LOCAL_EVENT_RUNNER.port)
// - a transcription job (POST /transcription-jobs; the transcriber stands in
//   for Transcribe, writing a placeholder WebVTT) finishing ->
//   applyTranscribeOutcome, called directly as transcribe-complete does after
//   it looks the job up
// - a scheduled cleanup coming due -> transcode-cleanup, with Scheduler's
//   payload, the schedule's delaySeconds (default LOCAL_EVENT_RUNNER.cleanupDelaySeconds)
//   after it's scheduled
// - a user first seen by an API's local server -> pre-token-generation, with
//   the event Cognito sends on sign-in (#230; see syncLocalUser)

if (process.env.LOCAL_DEV !== 'true') {
  throw new Error('The event runner is for local dev only (LOCAL_DEV=true)');
}

// What the notification-delivery handler reads when deployed from the stacks'
// environment variables; email counts as configured locally.
process.env.NOTIFICATIONS_FROM_ADDRESS ??=
  process.env.LOCAL_NOTIFICATIONS_FROM ?? LOCAL_NOTIFICATIONS_FROM;
process.env.STUDENT_PORTAL_URL ??= LOCAL_PORTAL_URLS.student;
process.env.INSTRUCTOR_PORTAL_URL ??= LOCAL_PORTAL_URLS.instructor;
process.env.ADMIN_PORTAL_URL ??= LOCAL_PORTAL_URLS.admin;
process.env.CORE_API_URL ??= LOCAL_CORE_API_URL;

const outcomeLogger = new Logger({ serviceName: 'TranscribeComplete' });

const log = (message: string, details?: unknown) =>
  console.log(
    `[event-runner] ${message}`,
    ...(details === undefined ? [] : [details]),
  );

// The parts of a Lambda context the handlers' middleware reads.
const lambdaContext = (functionName: string): Context =>
  ({
    functionName,
    functionVersion: '$LATEST',
    invokedFunctionArn: `arn:aws:lambda:local:000000000000:function:${functionName}`,
    memoryLimitInMB: '128',
    awsRequestId: randomUUID(),
    logGroupName: `/aws/lambda/${functionName}`,
    logStreamName: 'local',
    callbackWaitsForEmptyEventLoop: true,
    getRemainingTimeInMillis: () => 15 * 60_000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  }) as Context;

const invoke = async (
  functionName: string,
  handler: (event: never, context: Context) => Promise<unknown>,
  event: unknown,
) => {
  try {
    await handler(event as never, lambdaContext(functionName));
  } catch (error) {
    log(`${functionName} failed; not retried locally`, error);
  }
};

// A stream feature's handler, run as a failed Lambda invocation would: a throw
// is for the feature runner to retry.
const runFeatureHandler = async (
  name: string,
  handler: (event: never, context: Context) => Promise<unknown>,
  event: unknown,
) => {
  await handler(event as never, lambdaContext(name));
};

// ElasticMQ, whose queues (and visibility timeout, which outlasts a feature's
// 5 s batch window so a batch being gathered isn't received a second time) are
// created from the registry when its container starts.
const queue = createSqsQueueClient(new SQSClient(sqsClientConfig()));
const routerQueues = new Map(
  STREAM_FEATURES.map((feature) => [
    feature.name,
    {
      feature,
      queueName: localQueueUrl(localFeatureQueueName(feature.name)),
      failureQueueName: localQueueUrl(
        localFeatureFailureQueueName(feature.name),
      ),
    },
  ]),
);
const streamRouter = createStreamRouter({
  queue,
  queueFor: (feature) => localQueueUrl(localFeatureQueueName(feature)),
  failureQueue: localQueueUrl(LOCAL_QUEUES.routerFailureQueue),
});
const featureRunners = new Map(
  [...routerQueues].map(([name, { feature, queueName, failureQueueName }]) => {
    const handler = HANDLERS[feature.handler as keyof typeof HANDLERS];
    return [
      name,
      createFeatureRunner({
        feature,
        queue,
        queueName,
        failureQueueName,
        run: (event) => runFeatureHandler(name, handler, event),
        log,
      }),
    ] as const;
  }),
);

// The router retries the records it reports, as the stream mapping would.
const ROUTER_ATTEMPTS = 3;
const routeRecordsLocally = async (records: DynamoDBRecord[]) => {
  let pending = records;
  for (let attempt = 1; pending.length > 0; attempt++) {
    const { batchItemFailures } = await streamRouter({ Records: pending });
    if (batchItemFailures.length === 0) return;
    const failed = new Set(batchItemFailures.map((f) => f.itemIdentifier));
    pending = pending.filter((r) =>
      failed.has(r.dynamodb?.SequenceNumber ?? ''),
    );
    if (attempt >= ROUTER_ATTEMPTS) {
      log(`stream router gave up on ${pending.length} record(s)`, pending);
      return;
    }
  }
};

// The ffmpeg image (#137 has the comparison): /ffmpeg is its entrypoint,
// /ffprobe beside it. Pinned, at least 2 weeks old when chosen.
const FFMPEG_IMAGE = 'mwader/static-ffmpeg:9.0.2';
// Jobs' files, in the repo's git-ignored tmp/ so Docker can always mount it
// and a failed job's files can be looked at. Cleared on start.
const transcodeDir = fileURLToPath(
  new URL('../../../../tmp/local-dev/transcode', import.meta.url),
);

const docker: Docker = (args) =>
  new Promise((resolve) => {
    const child = spawn('docker', args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on('error', (error) =>
      resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` }),
    );
  });

await rm(transcodeDir, { recursive: true, force: true });
await mkdir(transcodeDir, { recursive: true });
// Pulled now, so the first job doesn't wait for it.
spawn('docker', ['pull', '--quiet', FFMPEG_IMAGE], { stdio: 'ignore' });

const transcoder = createTranscoder({
  docker,
  killContainer: (name) =>
    spawnSync('docker', ['kill', name], { stdio: 'ignore' }),
  s3: new S3Client(s3ClientConfig()),
  image: FFMPEG_IMAGE,
  workDir: transcodeDir,
  inputBucket: localBucketName('LessonMediaUploadBucket'),
  outputBucket: localBucketName('LessonMediaBucket'),
  only: (process.env.LOCAL_TRANSCODE_RENDITIONS ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean),
  onFinished: (jobId, status, { userMetadata }, durationSeconds) =>
    invoke(
      'transcode-complete',
      transcodeComplete,
      transcodeCompletionEvent(jobId, status, userMetadata, durationSeconds),
    ),
  log,
});

const transcriber = createTranscriber({
  s3: new S3Client(s3ClientConfig()),
  onFinished: (outcome) => applyTranscribeOutcome(outcomeLogger, outcome),
  log,
});

// The sent emails, in the repo's git-ignored tmp/, removed by reset-local-data.
const emailInbox = createEmailInbox({
  dir: fileURLToPath(
    new URL('../../../../tmp/local-dev/emails', import.meta.url),
  ),
});

const server = startEventRunnerServer({
  port: LOCAL_EVENT_RUNNER.port,
  stripe: createStripeStandIn({ log }),
  submitTranscodeJob: (request) => transcoder.submit(request),
  cancelTranscodeJob: (jobId) => transcoder.cancel(jobId),
  submitTranscriptionJob: (request) => transcriber.submit(request),
  scheduleTranscodeCleanup: ({ payload, delaySeconds }) => {
    const delay = delaySeconds ?? LOCAL_EVENT_RUNNER.cleanupDelaySeconds;
    log(
      `transcode-cleanup scheduled in ${delay}s for ${payload.contentItemId ?? `${payload.courseId} preview`}/${payload.submissionNonce}`,
    );
    setTimeout(
      () => void invoke('transcode-cleanup', transcodeCleanup, payload),
      delay * 1000,
    ).unref();
  },
  runPreTokenGeneration: async (request) => {
    log(`pre-token-generation <- ${request.userName}`);
    const synced = await syncUserFromPreTokenGenerationEvent(
      preTokenGenerationEvent(request),
    );
    if (!synced) {
      throw new Error(
        'The pre-token-generation trigger could not sync the user',
      );
    }
  },
  emailInbox,
  routerQueues: async () => ({
    features: await Promise.all(
      [...routerQueues.values()].map(async (entry) => {
        const [main, failed] = await Promise.all([
          queue.depth(entry.queueName),
          queue.depth(entry.failureQueueName),
        ]);
        return {
          name: entry.feature.name,
          queue: main,
          failures: { count: failed.waiting + failed.inFlight },
        };
      }),
    ),
  }),
  redriveFeature: async (name) => {
    const entry = routerQueues.get(name);
    if (!entry) return undefined;
    let redriven = 0;
    for (;;) {
      const messages = await queue.receive(entry.failureQueueName, 10, 0);
      if (messages.length === 0) return redriven;
      for (const message of messages) {
        await queue.move(entry.failureQueueName, entry.queueName, message);
        redriven += 1;
      }
    }
  },
  failFeature: (name, batches) => {
    const runner = featureRunners.get(name);
    if (!runner) return undefined;
    runner.failNext(batches);
    return batches;
  },
  log,
});
log(
  `transcode and transcription jobs, schedules, sign-ins and the email inbox on http://localhost:${LOCAL_EVENT_RUNNER.port} (inbox at /inbox)`,
);

const tableName = await resolveTableName();
const abort = new AbortController();
// ElasticMQ starts alongside this and takes a few seconds: until it answers,
// the feature runners would only log errors and the router would drop records.
const [firstQueue] = routerQueues.values();
await waitForQueue({
  queue,
  queueUrl: firstQueue.queueName,
  signal: abort.signal,
  log,
});
const runners = Promise.all(
  [...featureRunners.values()].map((runner) => runner.start(abort.signal)),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    abort.abort();
    server.close();
  });
}

// DynamoDB local can take a moment to start alongside this, and the table to
// be created (or get its stream).
for (let attempt = 1; ; attempt++) {
  try {
    log(`reading ${tableName}'s stream`);
    await pollStream({
      streams: new DynamoDBStreamsClient(dynamoDBClientConfig()),
      describeTable: () =>
        getDynamoDBClient().send(
          new DescribeTableCommand({ TableName: tableName }),
        ),
      onRecords: (records) => {
        routeRecordsLocally(records).catch((error) =>
          log('stream router failed', error),
        );
      },
      signal: abort.signal,
    });
    break;
  } catch (error) {
    if (abort.signal.aborted || attempt >= 30) throw error;
    log(`waiting for ${tableName}'s stream (${(error as Error).message})`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
await runners;
