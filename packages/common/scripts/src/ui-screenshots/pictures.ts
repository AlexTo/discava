/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// Which of the pictures an e2e run took belong to this pull request: the ones
// whose `screenshot(page, 'name')` call the diff adds. The rest come from
// earlier pull requests' scenarios, which still run and still take theirs.
// Used by the `E2E screenshots` comment (comment-main.ts).

import type { ChangedFile } from './check.js';

const SCENARIO = /^packages\/e2e\/src\/scenarios\/(.*)\.e2e\.ts$/;
// The helper's own slugging (packages/e2e/src/helpers/screenshots.ts), which
// names each file `<scenario>/NN-<name>.png`.
export const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
// A call with a literal name, on one line or split over several by the
// formatter. A name built at run time can't be told apart, so its picture
// lands under "other".
const CALL = /\bscreenshot\(\s*[\w.]+,\s*(['"`])((?:(?!\1).)*)\1/g;

export interface AddedPicture {
  scenario: string;
  name: string;
}

export const addedPictures = (files: ChangedFile[]): AddedPicture[] =>
  files.flatMap((file) => {
    const scenario = SCENARIO.exec(file.filename)?.[1];
    if (!scenario || file.status === 'removed') return [];
    const added = (file.patch ?? '')
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .map((line) => line.slice(1))
      .join('\n');
    return [...added.matchAll(CALL)].map((m) => ({
      scenario: slug(scenario.split('/').pop() ?? scenario),
      name: slug(m[2] ?? ''),
    }));
  });

// `paths` are `<scenario>/NN-<name>.png`.
export const splitPictures = (paths: string[], added: AddedPicture[]) => {
  const isAdded = (path: string) =>
    added.some(({ scenario, name }) =>
      new RegExp(`^${scenario}/\\d+-${name}\\.png$`).test(path),
    );
  return {
    mine: paths.filter(isAdded),
    other: paths.filter((path) => !isAdded(path)),
  };
};

export const MARKER = '<!-- e2e-screenshots -->';

const list = (paths: string[]) =>
  paths.map((path) => `- \`${path}\``).join('\n');

export const commentBody = (options: {
  sha: string;
  runUrl: string;
  paths: string[];
  added: AddedPicture[];
}): string => {
  const short = options.sha.slice(0, 7);
  const lines = [MARKER, '### E2E screenshots', ''];
  if (options.paths.length === 0) {
    lines.push(
      `No scenario took screenshots on \`${short}\`. A pull request that changes what a user sees should add \`screenshot(page, 'name')\` calls to an e2e scenario (see packages/e2e/README.md).`,
    );
    return `${lines.join('\n')}\n`;
  }
  const { mine, other } = splitPictures(
    [...options.paths].sort(),
    options.added,
  );
  lines.push(
    `Taken by the e2e scenarios on \`${short}\`. Download the \`e2e-screenshots-*\` artifacts from [the run](${options.runUrl}#artifacts).`,
    '',
  );
  if (mine.length > 0) {
    lines.push(
      `**Added by this pull request (${mine.length})**`,
      '',
      list(mine),
    );
  } else {
    lines.push(
      'This pull request adds no `screenshot(` call, so none of these pictures show its change.',
    );
  }
  if (other.length > 0) {
    lines.push(
      '',
      '<details>',
      `<summary>From scenarios that were already there (${other.length})</summary>`,
      '',
      list(other),
      '',
      '</details>',
    );
  }
  return `${lines.join('\n')}\n`;
};
