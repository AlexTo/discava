/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';

// The portals fetch the published brand (`brand/brand.json`) from S3Mock in
// local dev, from a page on another origin, so S3Mock must answer a
// cross-origin GET with Access-Control-Allow-Origin (plan risk R1). Runs only
// when S3Mock is up (`pnpm dev`); otherwise skipped.
const BASE = 'http://localhost:9090/discava-public-media/';
const PORTAL = 'http://localhost:4201';

const reachable = await fetch(BASE, {
  method: 'HEAD',
  signal: AbortSignal.timeout(500),
}).then(
  () => true,
  () => false,
);

describe('S3Mock CORS for the published brand', () => {
  it.skipIf(!reachable)(
    'answers a cross-origin GET of brand/brand.json with Access-Control-Allow-Origin',
    async () => {
      const response = await fetch(`${BASE}brand/brand.json`, {
        headers: { Origin: PORTAL },
      });
      // Whether or not a brand has been published yet, the answer must let
      // the portal read it: a 404 before the first save still needs the header.
      expect([200, 404]).toContain(response.status);
      const allowed = response.headers.get('access-control-allow-origin');
      expect(allowed === '*' || allowed === PORTAL).toBe(true);
    },
  );
});
