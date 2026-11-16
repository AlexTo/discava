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

// Waits until no feature has a message waiting or in flight, so what the
// stream carried has been handled (a failed batch stays in flight until its
// visibility timeout, so this also waits out retries).
export const waitForQueuesToDrain = async (timeout = 60_000) =>
  expect
    .poll(
      async () =>
        (await routerQueues()).filter(
          ({ queue }) => queue.waiting + queue.inFlight > 0,
        ).length,
      { message: 'The router queues did not drain', timeout },
    )
    .toBe(0);

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
