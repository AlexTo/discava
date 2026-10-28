/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { defineConfig, devices } from '@playwright/test';
import { PORTALS } from './src/helpers/portals.js';

const CI = !!process.env.CI;

// End-to-end tests against the whole local stack (#3): the portals, APIs and
// event runner from `pnpm dev`, with DynamoDB local, S3Mock and the local
// OIDC server standing in for AWS. Locally they reuse a running `pnpm dev`;
// in CI they start one.
export default defineConfig({
  // User flows in src/scenarios; requests racing each other, made straight to
  // the APIs, in src/concurrency.
  testDir: './src',
  testMatch: ['scenarios/**/*.e2e.ts', 'concurrency/**/*.e2e.ts'],
  outputDir: '../../dist/packages/e2e/test-results',
  // Scenarios share one stack; each makes its own users and courses, so they
  // could run side by side, but one at a time keeps a slow transcode or stream
  // from crowding the others out on a small CI runner.
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // A scenario walks several pages and waits on background work (progress
  // recalculation runs a few seconds after a change).
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: CI
    ? [
        ['list'],
        [
          'html',
          { open: 'never', outputFolder: '../../dist/packages/e2e/report' },
        ],
      ]
    : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  globalSetup: './src/global-setup.ts',
  webServer: {
    command: 'pnpm dev',
    cwd: '../..',
    url: PORTALS.student,
    reuseExistingServer: !CI,
    // A cold start pulls the local containers' images.
    timeout: 5 * 60_000,
    // As Ctrl-C would, so the local containers are stopped too.
    gracefulShutdown: { signal: 'SIGINT', timeout: 30_000 },
    // In CI, the stack's output goes in the job log, to see why it didn't
    // start or what a service did; locally it'd drown the test output.
    stdout: CI ? 'pipe' : 'ignore',
    stderr: 'pipe',
  },
});
