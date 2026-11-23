/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { ChangedFile } from './check.js';
import { addedPictures, commentBody, MARKER } from './pictures.js';

// The entry point `nx run @discava/tooling-agent:screenshots-comment` runs,
// for the `E2E screenshots` job in .github/workflows/pr-checks.yml: one
// comment on the pull request, kept up to date, naming the pictures the e2e
// scenarios took. SCREENSHOTS_DIR holds the downloaded `e2e-screenshots-*`
// artifacts, one folder each.
//
// The list also goes in the job summary. A pull request can be locked (Post-
// merge Verify locks the ones it hands the test agent), and GitHub refuses
// the Actions token a comment on a locked conversation whatever its
// permissions, so for one of those the summary is the only place the list
// appears. Unlocking it to comment would let anyone comment in between,
// which the lock is there to stop.
const {
  GITHUB_REPOSITORY,
  GITHUB_STEP_SUMMARY,
  PR,
  SHA,
  RUN_URL,
  SCREENSHOTS_DIR,
} = process.env;
if (!GITHUB_REPOSITORY || !PR || !SHA || !RUN_URL || !SCREENSHOTS_DIR) {
  throw new Error(
    'GITHUB_REPOSITORY, PR, SHA, RUN_URL and SCREENSHOTS_DIR must be set',
  );
}

const gh = (args: string[]) =>
  execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const pngs = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return pngs(path);
      return entry.name.endsWith('.png') ? [path] : [];
    });
  } catch {
    return [];
  }
};
// `<artifact>/<scenario>/NN-name.png` -> `<scenario>/NN-name.png`
const paths = pngs(SCREENSHOTS_DIR).map((path) =>
  relative(SCREENSHOTS_DIR, path).split(sep).slice(1).join('/'),
);

const pages = JSON.parse(
  gh([
    'api',
    '--paginate',
    '--slurp',
    `repos/${GITHUB_REPOSITORY}/pulls/${PR}/files?per_page=100`,
  ]),
) as ChangedFile[][];

const body = commentBody({
  sha: SHA,
  runUrl: RUN_URL,
  paths,
  added: addedPictures(pages.flat()),
});
writeFileSync('body.md', body);
if (GITHUB_STEP_SUMMARY) {
  appendFileSync(GITHUB_STEP_SUMMARY, `${body}\n`);
}

const locked =
  gh([
    'api',
    `repos/${GITHUB_REPOSITORY}/issues/${PR}`,
    '--jq',
    '.locked',
  ]).trim() === 'true';
if (locked) {
  console.log(
    `::notice::#${PR} is locked, so the Actions token can't comment on it: the screenshots are listed in this job's summary (${RUN_URL}).`,
  );
  process.exit(0);
}

const id = gh([
  'api',
  '--paginate',
  `repos/${GITHUB_REPOSITORY}/issues/${PR}/comments`,
  '--jq',
  `.[] | select(.body | startswith("${MARKER}")) | .id`,
])
  .split('\n')
  .find(Boolean);
if (id) {
  gh([
    'api',
    '-X',
    'PATCH',
    `repos/${GITHUB_REPOSITORY}/issues/comments/${id}`,
    '-F',
    'body=@body.md',
  ]);
} else {
  gh([
    'api',
    `repos/${GITHUB_REPOSITORY}/issues/${PR}/comments`,
    '-F',
    'body=@body.md',
  ]);
}
