/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBStreamsClient } from '@aws-sdk/client-dynamodb-streams';
import { S3Client } from '@aws-sdk/client-s3';
import {
  LOCAL_EVENT_RUNNER,
  localBucketName,
  s3ClientConfig,
} from '@discava/common-server-utils/local-dev';
import {
  dynamoDBClientConfig,
  getDynamoDBClient,
  matchesProgressStreamFilters,
  resolveTableName,
} from '@discava/core-table';
import type { Context, DynamoDBRecord } from 'aws-lambda';
import { syncUserFromPreTokenGenerationEvent } from '../identity/pre-token-generation.js';
import { handler as transcodeCleanup } from '../media/transcode-cleanup.js';
import { handler as transcodeComplete } from '../media/transcode-complete.js';
import { handler as progressRecalculation } from '../progress/progress-recalculation.js';
import { createBatcher, pollStream } from './dynamodb-stream.js';
import { startEventRunnerServer } from './event-runner-server.js';
import {
  preTokenGenerationEvent,
  transcodeCompletionEvent,
} from './trigger-events.js';
import { createTranscoder, type Docker } from './transcoder.js';

// Local dev's event runner (#137): what AWS does to trigger the event handlers
// when deployed, done locally, so local changes reach the same handler logic.
// Each trigger gets the event shape it delivers; most call the real exported
// handler. Failures are logged, not retried; AWS's retries, batch bisecting
// and failure queues are only on dev.
//
// Triggers so far:
// - the core table's stream -> progress-recalculation, filtered and batched
//   like its event source mapping (PROGRESS_STREAM_FILTERS, 100 records or
//   5 s)
// - a local transcode finishing -> transcode-complete, with the EventBridge
//   event MediaConvert would emit (the transcoder stands in for MediaConvert;
//   instructor-api submits and cancels jobs on LOCAL_EVENT_RUNNER.port)
// - a scheduled cleanup coming due -> transcode-cleanup, with Scheduler's
//   payload, LOCAL_EVENT_RUNNER.cleanupDelaySeconds after it's scheduled
// - a user first seen by an API's local server -> pre-token-generation, with
//   the event Cognito sends on sign-in (#230; see syncLocalUser)

if (process.env.LOCAL_DEV !== 'true') {
  throw new Error('The event runner is for local dev only (LOCAL_DEV=true)');
}

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

const progressBatches = createBatcher<DynamoDBRecord>({
  maxRecords: 100,
  windowMs: 5000,
  deliver: async (Records) => {
    log(`progress-recalculation <- ${Records.length} stream record(s)`);
    await invoke('progress-recalculation', progressRecalculation, { Records });
  },
});

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
  onFinished: (jobId, status, { userMetadata }) =>
    invoke(
      'transcode-complete',
      transcodeComplete,
      transcodeCompletionEvent(jobId, status, userMetadata),
    ),
  log,
});

const server = startEventRunnerServer({
  port: LOCAL_EVENT_RUNNER.port,
  submitTranscodeJob: (request) => transcoder.submit(request),
  cancelTranscodeJob: (jobId) => transcoder.cancel(jobId),
  scheduleTranscodeCleanup: ({ payload }) => {
    log(
      `transcode-cleanup scheduled in ${LOCAL_EVENT_RUNNER.cleanupDelaySeconds}s for ${payload.contentItemId}/${payload.submissionNonce}`,
    );
    setTimeout(
      () => void invoke('transcode-cleanup', transcodeCleanup, payload),
      LOCAL_EVENT_RUNNER.cleanupDelaySeconds * 1000,
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
  log,
});
log(
  `transcode jobs, schedules and sign-ins on http://localhost:${LOCAL_EVENT_RUNNER.port}`,
);

const tableName = await resolveTableName();
const abort = new AbortController();
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
      onRecords: (records) =>
        progressBatches.add(records.filter(matchesProgressStreamFilters)),
      signal: abort.signal,
    });
    break;
  } catch (error) {
    if (abort.signal.aborted || attempt >= 30) throw error;
    log(`waiting for ${tableName}'s stream (${(error as Error).message})`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
await progressBatches.flush();
