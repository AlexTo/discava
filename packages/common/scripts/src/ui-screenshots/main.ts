/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  type ChangedFile,
  checkUiScreenshots,
  failureMessage,
} from './check.js';

// The entry point `nx run @discava/common-scripts:ui-screenshots` runs, for
// .github/workflows/ui-screenshots.yml. It reads the pull request's diff from
// the API, never checking its code out.
const repository = process.env.GITHUB_REPOSITORY;
const eventPath = process.env.GITHUB_EVENT_PATH;
if (!repository || !eventPath) {
  throw new Error('GITHUB_REPOSITORY and GITHUB_EVENT_PATH must be set');
}
const event = JSON.parse(readFileSync(eventPath, 'utf8')) as {
  pull_request: { number: number; labels: { name: string }[] };
};
const { number } = event.pull_request;

// --slurp joins the pages into one array of arrays.
const pages = JSON.parse(
  execFileSync(
    'gh',
    [
      'api',
      '--paginate',
      '--slurp',
      `repos/${repository}/pulls/${number}/files?per_page=100`,
    ],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  ),
) as ChangedFile[][];

const verdict = checkUiScreenshots(
  pages.flat(),
  event.pull_request.labels.map((label) => label.name),
);
if (verdict.ok) {
  console.log(`OK: ${verdict.reason}`);
} else {
  console.log(`::error::${failureMessage(verdict.uiFiles)}`);
  process.exit(1);
}
