/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { QueueClient } from '../router/queue-client.js';

export interface WaitForQueueOptions {
  queue: Pick<QueueClient, 'depth'>;
  /** A queue that exists as soon as the queue service is up. */
  queueUrl: string;
  signal?: AbortSignal;
  intervalMs?: number;
  /** How many times to ask before giving up with the last error. */
  attempts?: number;
  log?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Resolves once the local queue service (ElasticMQ in Docker) answers. Nx
 * starts its container alongside the event runner without waiting for it, and
 * the JVM takes a few seconds, so records routed before it listens would be
 * dropped. Gives up after `attempts` (default 60 at 1 s, a minute) rather
 * than hang forever on a broken container.
 */
export const waitForQueue = async ({
  queue,
  queueUrl,
  signal,
  intervalMs = 1000,
  attempts = 60,
  log = () => undefined,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: WaitForQueueOptions): Promise<void> => {
  for (let attempt = 1; ; attempt++) {
    try {
      await queue.depth(queueUrl);
      return;
    } catch (error) {
      if (signal?.aborted) return;
      if (attempt >= attempts) throw error;
      if (attempt === 1) {
        log(
          `waiting for the local queue service (${(error as Error).message})`,
        );
      }
      await sleep(intervalMs);
    }
  }
};
