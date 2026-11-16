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
// the `UI Screenshots` job in .github/workflows/pr-checks.yml. It reads the
// pull request's diff and labels from the API, at the time it runs, so a
// waiver label takes effect when the job is re-run.
const repository = process.env.GITHUB_REPOSITORY;
const eventPath = process.env.GITHUB_EVENT_PATH;
if (!repository || !eventPath) {
  throw new Error('GITHUB_REPOSITORY and GITHUB_EVENT_PATH must be set');
}
const event = JSON.parse(readFileSync(eventPath, 'utf8')) as {
  pull_request: { number: number };
};
const { number } = event.pull_request;

const gh = (args: string[]) =>
  execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

// --slurp joins the pages into one array of arrays.
const pages = JSON.parse(
  gh([
    'api',
    '--paginate',
    '--slurp',
    `repos/${repository}/pulls/${number}/files?per_page=100`,
  ]),
) as ChangedFile[][];
// Not the event's labels: those are from when the run started.
const labels = gh([
  'api',
  `repos/${repository}/issues/${number}/labels`,
  '--jq',
  '.[].name',
])
  .split('\n')
  .filter(Boolean);

const verdict = checkUiScreenshots(pages.flat(), labels);
if (verdict.ok) {
  console.log(`OK: ${verdict.reason}`);
} else {
  console.log(`::error::${failureMessage(verdict.uiFiles)}`);
  process.exit(1);
}
