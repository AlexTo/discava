/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBStreamsClient } from '@aws-sdk/client-dynamodb-streams';
import {
  dynamoDBClientConfig,
  getDynamoDBClient,
  matchesProgressStreamFilters,
  resolveTableName,
} from '@discava/core-table';
import type { Context, DynamoDBRecord } from 'aws-lambda';
import { handler as progressRecalculation } from '../progress/progress-recalculation.js';
import { createBatcher, pollStream } from './dynamodb-stream.js';

// Local dev's event runner (#137): what AWS does to trigger the event handlers
// when deployed, done locally, so local changes reach the same handlers. Each
// handler is called as Lambda would call it: the real exported handler, with
// the event shape its trigger delivers. Failures are logged, not retried; AWS's
// retries, batch bisecting and failure queues are only on dev.
//
// Triggers so far:
// - the core table's stream -> progress-recalculation, filtered and batched
//   like its event source mapping (PROGRESS_STREAM_FILTERS, 100 records or
//   5 s)

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

const tableName = await resolveTableName();
const abort = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => abort.abort());
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
