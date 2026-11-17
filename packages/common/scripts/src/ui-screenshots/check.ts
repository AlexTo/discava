/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// Holds a pull request that changes what a user sees to show it: some e2e
// scenario must gain a `screenshot(` call (packages/e2e/src/helpers/
// screenshots.ts), so PR Checks' `E2E screenshots` comment has pictures for
// the reviewer. A maintainer waives it with a label, for a change with
// nothing to look at.

export const WAIVER_LABEL = 'no-ui-screenshots';

export interface ChangedFile {
  filename: string;
  status: string;
  /** The unified diff; GitHub leaves it out for a very large or binary file. */
  patch?: string;
}

// What a user sees: a portal's or the shared components' markup and styles.
// Not their tests, and not generated files.
const UI_SOURCE =
  /^packages\/(websites\/[^/]+|common\/shadcn)\/src\/.*\.(tsx|css)$/;
const NOT_UI = /(\.test\.tsx?$|\.gen\.tsx?$|\.d\.ts$)/;
const SCENARIO = /^packages\/e2e\/src\/scenarios\/.*\.e2e\.ts$/;
// An added line that calls the helper.
const ADDED_SCREENSHOT = /^\+.*\bscreenshot\(/m;

export const isUiSource = (file: string): boolean =>
  UI_SOURCE.test(file) && !NOT_UI.test(file);

export type Verdict =
  | { ok: true; reason: string }
  | { ok: false; uiFiles: string[] };

export const checkUiScreenshots = (
  files: ChangedFile[],
  labels: string[],
): Verdict => {
  const uiFiles = files
    .filter((file) => file.status !== 'removed' && isUiSource(file.filename))
    .map((file) => file.filename);
  if (uiFiles.length === 0) {
    return { ok: true, reason: 'no portal or shared UI source changed' };
  }
  if (labels.includes(WAIVER_LABEL)) {
    return { ok: true, reason: `waived by the \`${WAIVER_LABEL}\` label` };
  }
  const scenario = files.find(
    (file) =>
      SCENARIO.test(file.filename) && ADDED_SCREENSHOT.test(file.patch ?? ''),
  );
  if (scenario) {
    return { ok: true, reason: `${scenario.filename} takes screenshots` };
  }
  return { ok: false, uiFiles };
};

export const failureMessage = (uiFiles: string[]): string =>
  [
    `This pull request changes UI source (${uiFiles.slice(0, 5).join(', ')}${uiFiles.length > 5 ? `, and ${uiFiles.length - 5} more` : ''}) but no e2e scenario gained a \`screenshot(page, 'name')\` call.`,
    'Add them to the scenario for the flow you changed, at the states a reviewer would otherwise open `pnpm dev` to see (see packages/e2e/README.md, "Screenshots for the pull request").',
    `If there is genuinely nothing to look at (a refactor, a copy fix), a maintainer can apply the \`${WAIVER_LABEL}\` label.`,
  ].join(' ');
