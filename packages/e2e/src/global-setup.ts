/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { PORTALS, SERVICES } from './helpers/portals.js';

const TIMEOUT_MS = 3 * 60_000;
const INTERVAL_MS = 1_000;

// Waits until a URL answers at all: any HTTP status means its server is up
// (the APIs answer 404 at their root).
const waitForHttp = async (name: string, url: string) => {
  const deadline = Date.now() + TIMEOUT_MS;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(5_000) });
      return;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
  throw new Error(
    `${name} (${url}) didn't answer within ${TIMEOUT_MS / 1000}s`,
    {
      cause: last,
    },
  );
};

// Playwright's webServer waits for the student portal only; `pnpm dev` starts
// everything else alongside it, not necessarily first.
export default async function globalSetup() {
  await Promise.all(
    Object.entries({ ...PORTALS, ...SERVICES }).map(([name, url]) =>
      waitForHttp(name, url),
    ),
  );
}
