/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { transactionConflict } from './trpc-api-base.js';

export const MAX_TRANSACTION_ATTEMPTS = 7;
// The ceiling of the first wait; each later one doubles it, up to the cap.
const BASE_DELAY_MS = 25;
const MAX_DELAY_MS = 800;

export type Attempt<T> = { committed: true; value: T } | { committed: false };

export interface RetryOptions {
  maxAttempts?: number;
  /** Replaces the real wait; tests pass one that records the ceiling. */
  wait?: (ceilingMs: number) => Promise<void>;
}

const randomWait = (ceilingMs: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, Math.random() * ceilingMs);
  });

// Runs `attempt` until it commits. DynamoDB cancels a transaction that touches
// an item another transaction is changing, even for an atomic ADD, so writers
// on one hot record need room to get through. Each attempt re-reads and
// decides on fresh state; between attempts we wait a random time between 0
// and an exponentially growing ceiling (full jitter), so writers that
// collided don't collide again in step. Once the attempts are used up the
// result is CONFLICT; nothing was changed and the client may retry.
export const retryTransaction = async <T>(
  attempt: () => Promise<Attempt<T>>,
  {
    maxAttempts = MAX_TRANSACTION_ATTEMPTS,
    wait = randomWait,
  }: RetryOptions = {},
): Promise<T> => {
  for (let n = 0; n < maxAttempts; n++) {
    const outcome = await attempt();
    if (outcome.committed) {
      return outcome.value;
    }
    if (n < maxAttempts - 1) {
      await wait(Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** n));
    }
  }
  throw transactionConflict();
};
