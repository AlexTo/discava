/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { StreamFeature } from '@discava/core-table';
import type { DynamoDBRecord, SQSEvent } from 'aws-lambda';
import type { QueueClient, ReceivedMessage } from '../router/queue-client.js';
import { sqsStreamRecords } from '../router/sqs-stream-records.js';

export interface FeatureRunnerOptions {
  feature: StreamFeature;
  queue: QueueClient;
  queueName: string;
  failureQueueName: string;
  /** Runs the feature's handler; throws when the handler does. */
  run: (event: { Records: DynamoDBRecord[] }) => Promise<void>;
  log: (message: string, details?: unknown) => void;
  /** How long to wait before polling again when the queue is empty. */
  idleMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const RECEIVE_SIZE = 10;

/**
 * Local dev's stand-in for one feature's queue-to-Lambda event source
 * mapping: polls the feature's queue, gathers messages into a batch the way
 * the registration says (`maxRecords`, or `windowSeconds` after the first
 * message), runs the handler on it and deletes the messages once it succeeds.
 * When the handler throws, the messages return after the queue's visibility
 * timeout; one that has been received `maxReceiveCount` times moves to the
 * failure queue and is logged, as the queue's redrive policy does when
 * deployed. Features run independently, so one failing doesn't hold up another.
 */
export const createFeatureRunner = ({
  feature,
  queue,
  queueName,
  failureQueueName,
  run,
  log,
  idleMs = 250,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
}: FeatureRunnerOptions) => {
  let failingBatches = 0;

  const gather = async (): Promise<ReceivedMessage[]> => {
    const batch: ReceivedMessage[] = [];
    let deadline = Number.POSITIVE_INFINITY;
    const { maxRecords, windowSeconds } = feature.batch;
    while (batch.length < maxRecords && now() < deadline) {
      const received = await queue.receive(
        queueName,
        Math.min(RECEIVE_SIZE, maxRecords - batch.length),
        0,
      );
      if (received.length > 0) {
        if (batch.length === 0) deadline = now() + windowSeconds * 1000;
        batch.push(...received);
      } else if (batch.length === 0) {
        break;
      } else {
        await sleep(Math.min(idleMs, Math.max(0, deadline - now())));
      }
    }
    return batch;
  };

  const runBatch = async (batch: ReceivedMessage[]) => {
    log(`${feature.name} <- ${batch.length} message(s)`);
    try {
      if (failingBatches > 0) {
        failingBatches -= 1;
        throw new Error('Failure forced by POST /router/fail');
      }
      // Only the bodies matter to sqsStreamRecords.
      const event = {
        Records: batch.map(({ body }) => ({ body })),
      } as Pick<SQSEvent, 'Records'>;
      await run(sqsStreamRecords(event));
    } catch (error) {
      log(`${feature.name} failed; its messages will be received again`, error);
      for (const message of batch) {
        if (message.receiveCount >= feature.maxReceiveCount) {
          await queue.move(queueName, failureQueueName, message);
          log(
            `${feature.name} message ${message.id} moved to ${failureQueueName} after ${message.receiveCount} receives`,
            message.body,
          );
        }
      }
      return;
    }
    await Promise.all(
      batch.map((message) => queue.delete(queueName, message.receiptHandle)),
    );
  };

  /** Runs one batch if the queue has messages; false when it was empty. */
  const runOnce = async (): Promise<boolean> => {
    const batch = await gather();
    if (batch.length === 0) return false;
    await runBatch(batch);
    return true;
  };

  return {
    runOnce,
    /** Makes the handler fail for the next `batches` batches (0 clears it). */
    failNext(batches: number) {
      failingBatches = batches;
    },
    failing: () => failingBatches,
    /** Polls until `signal` aborts. */
    async start(signal: AbortSignal) {
      while (!signal.aborted) {
        try {
          if (await runOnce()) continue;
        } catch (error) {
          log(`${feature.name} runner error`, error);
        }
        await sleep(idleMs);
      }
    },
  };
};
