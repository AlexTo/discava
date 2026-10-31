/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { PORTALS, SEARCH_INDEX_URL, SERVICES } from './helpers/portals.js';

const TIMEOUT_MS = 3 * 60_000;
const INTERVAL_MS = 1_000;

const retryUntil = async (
  name: string,
  url: string,
  succeeds: (response: Response) => boolean,
) => {
  const deadline = Date.now() + TIMEOUT_MS;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (succeeds(response)) {
        return;
      }
      last = new Error(`${name} (${url}) answered ${response.status}`);
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
  throw new Error(
    `${name} (${url}) wasn't ready within ${TIMEOUT_MS / 1000}s`,
    {
      cause: last,
    },
  );
};

// Waits until a URL answers at all: any HTTP status means its server is up
// (the APIs answer 404 at their root).
const waitForHttp = (name: string, url: string) =>
  retryUntil(name, url, () => true);

// Waits for the `courses` index itself (200), not just for OpenSearch to
// answer: `@discava/search`'s `dev` target starts the local container and
// syncs its indices in parallel, so the container can answer well before the
// index exists (a search run too early would 404, #267).
const waitForSearchIndex = (url: string) =>
  retryUntil('search index', url, (response) => response.ok);

// Playwright's webServer waits for the student portal only; `pnpm dev` starts
// everything else alongside it, not necessarily first.
export default async function globalSetup() {
  await Promise.all([
    ...Object.entries({ ...PORTALS, ...SERVICES }).map(([name, url]) =>
      waitForHttp(name, url),
    ),
    waitForSearchIndex(SEARCH_INDEX_URL),
  ]);
}
