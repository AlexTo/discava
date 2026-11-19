/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  addedLines,
  checkInvariantCoverage,
  failureMessage,
  findTriggers,
  INVARIANTS_PATHSPEC,
  SNAPSHOT_PATH,
  sameWriterMap,
  snapshotKeys,
  WRITER_MAP_PATH,
  type WriterMap,
} from './check.js';
import { scanEntityWriters, WORKSPACE_ROOT } from './scan.js';

// The entry point `nx run @discava/common-scripts:invariant-coverage` runs,
// for the `Invariant coverage` job in .github/workflows/pr-checks.yml, and
// locally against origin/main. First, the committed entity-writers.json must
// match the code; then the writers it gained over the base branch's copy
// must come with an invariants-folder change naming each entity, or the waiver
// label.
const baseRef = process.env.BASE_REF || 'main';

const run = (command: string, args: string[]) =>
  execFileSync(command, args, {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });

const committed = JSON.parse(
  readFileSync(path.join(WORKSPACE_ROOT, WRITER_MAP_PATH), 'utf8'),
) as WriterMap;
const scanned = scanEntityWriters();
if (!sameWriterMap(committed, scanned)) {
  console.log(
    `::error::${WRITER_MAP_PATH} is out of date with the code. Run \`pnpm nx run @discava/common-scripts:entity-writers\` and commit the result.`,
  );
  process.exit(1);
}

let before: WriterMap;
try {
  before = JSON.parse(
    run('git', ['show', `origin/${baseRef}:${WRITER_MAP_PATH}`]),
  ) as WriterMap;
} catch {
  console.log(
    `OK: origin/${baseRef} has no ${WRITER_MAP_PATH} yet to compare with`,
  );
  process.exit(0);
}

const keys = snapshotKeys(
  readFileSync(path.join(WORKSPACE_ROOT, SNAPSHOT_PATH), 'utf8'),
);
const added = addedLines(
  run('git', [
    'diff',
    `origin/${baseRef}...HEAD`,
    '--',
    ...INVARIANTS_PATHSPEC,
  ]),
);

// Read from the API when it runs, not the event's, so a waiver label takes
// effect when the job is re-run. None locally.
const labels = (() => {
  const repository = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!repository || !eventPath) {
    return [];
  }
  const { number } = (
    JSON.parse(readFileSync(eventPath, 'utf8')) as {
      pull_request: { number: number };
    }
  ).pull_request;
  return run('gh', [
    'api',
    `repos/${repository}/issues/${number}/labels`,
    '--jq',
    '.[].name',
  ])
    .split('\n')
    .filter(Boolean);
})();

const verdict = checkInvariantCoverage(
  findTriggers(before, scanned),
  { added, snapshotKeys: keys },
  labels,
);
if (verdict.ok) {
  console.log(`OK: ${verdict.reason}`);
} else {
  // A multi-line annotation needs its newlines escaped.
  console.log(
    `::error::${failureMessage(verdict.triggers, keys).replaceAll('\n', '%0A')}`,
  );
  console.log(failureMessage(verdict.triggers, keys));
  process.exit(1);
}
