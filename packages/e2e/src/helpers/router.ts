/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect } from '@playwright/test';

// The local event runner's stream router routes (packages/events,
// src/local/event-runner-server.ts), on the runner's port (2024, from
// LOCAL_EVENT_RUNNER in common-server-utils/local-dev).
const RUNNER = 'http://127.0.0.1:2024';

export interface RouterFeatureState {
  name: string;
  queue: { waiting: number; inFlight: number };
  failures: { count: number };
}

const call = async <T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
) => {
  const response = await fetch(`${RUNNER}${path}`, {
    method,
    ...(body !== undefined && {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
  expect(response.ok, `${method} ${path}: ${response.status}`).toBe(true);
  return (await response.json()) as T;
};

export const routerQueues = async (): Promise<RouterFeatureState[]> =>
  (await call<{ features: RouterFeatureState[] }>('GET', '/router/queues'))
    .features;

// How long the queues must stay empty to count as drained. A write's stream
// record reaches the queues only once the runner's stream poll (1 s) reads
// and routes it, and until then every queue looks empty, so a single empty
// reading straight after a write proves nothing.
const QUIET_MS = 3_000;

// Waits until no feature has a message waiting or in flight, continuously for
// QUIET_MS, so what the stream carried has been routed and handled (a failed
// batch stays in flight until its visibility timeout, so this also waits out
// retries).
export const waitForQueuesToDrain = async (timeout = 60_000) => {
  let emptySince: number | undefined;
  await expect
    .poll(
      async () => {
        const busy = (await routerQueues()).some(
          ({ queue }) => queue.waiting + queue.inFlight > 0,
        );
        if (busy) {
          emptySince = undefined;
          return false;
        }
        emptySince ??= Date.now();
        return Date.now() - emptySince >= QUIET_MS;
      },
      { message: 'The router queues did not drain', timeout },
    )
    .toBe(true);
};

export const redrive = (feature: string) =>
  call<{ feature: string; redriven: number }>(
    'POST',
    `/router/redrive/${feature}`,
  );

export const failNextBatches = (feature: string, batches: number) =>
  call<{ feature: string; failing: number }>(
    'POST',
    `/router/fail/${feature}`,
    {
      batches,
    },
  );
