/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  archivedPath,
  isFinished,
  livePath,
  rewriteForArchive,
} from './archive.js';
import {
  ARCHIVE_FOLDER,
  featureName,
  isSpecFolderName,
  MARKER_PREFIX,
  markerFolder,
} from './issue.js';

// Opens a pull request that moves each finished spec (every task in its
// tasks.md ticked, (human) ones too) to specs/_archive/ and fixes the links
// to and from it. Run by .github/workflows/archive-specs.yml when a tasks.md
// changes on main, or by hand. A spec is skipped while an agent issue for it
// is open, and once an archive pull request was opened for it: closing one
// unmerged keeps the spec live for good (move it by hand later).
// DRY_RUN=true only lists what it would archive.

export interface Deps {
  env: Record<string, string | undefined>;
  /** Runs the GitHub CLI with these arguments and returns its output. */
  gh: (args: string[]) => string;
  /** Runs git with these arguments in the repository and returns its output. */
  git: (args: string[]) => string;
  log: (message: string) => void;
}

export const archiveBranch = (folder: string): string =>
  `archive-spec/${folder}`;

const bodyFile = (body: string): string => {
  const file = join(mkdtempSync(join(tmpdir(), 'archive-spec-')), 'body.md');
  writeFileSync(file, body);
  return file;
};

const lines = (output: string): string[] => output.split('\n').filter(Boolean);

/** The live spec folders whose tasks.md has every task ticked. */
export const finishedFolders = (root: string): string[] => {
  const specs = join(root, 'specs');
  return (existsSync(specs) ? readdirSync(specs) : [])
    .filter((folder) => folder !== ARCHIVE_FOLDER && isSpecFolderName(folder))
    .filter((folder) => {
      const file = join(specs, folder, 'tasks.md');
      return existsSync(file) && isFinished(readFileSync(file, 'utf8'));
    })
    .sort();
};

// The spec folders named by an open issue's marker: their agent work is
// still going.
const foldersWithOpenIssues = (repository: string, gh: Deps['gh']) =>
  new Set(
    lines(
      gh([
        'api',
        `repos/${repository}/issues?state=open&per_page=100`,
        '--paginate',
        '--jq',
        `.[] | select(.pull_request == null) | (.body // "") | select(contains("${MARKER_PREFIX}")) | @json`,
      ]),
    )
      .map((line) => markerFolder(JSON.parse(line) as string))
      .filter((folder): folder is string => folder !== undefined),
  );

const prBody = (folder: string): string =>
  [
    `Every task in \`${livePath(folder)}/tasks.md\` is ticked, so this moves the spec to \`${archivedPath(folder)}/\` (see \`specs/README.md\`, "When to archive").`,
    '',
    'Opened by the **Archive Specs** workflow, which also fixed the links to and from the folder: relative Markdown links, and plain mentions of its path such as the design page\'s "Spec" link and code comments.',
    '',
    `Before merging, look for mentions of the old path it could not fix, such as one split across two lines: \`git grep -n "${featureName(folder)}" -- ':!specs/${ARCHIVE_FOLDER}'\`.`,
    '',
    'Pull requests opened by a workflow do not start the PR checks: close and reopen this one to run them. Close it without merging to keep the spec live; the workflow will not open another for it.',
    '',
  ].join('\n');

export const run = ({ env, gh, git, log }: Deps): void => {
  const repository = env.GITHUB_REPOSITORY;
  if (!repository) {
    throw new Error('GITHUB_REPOSITORY must be set');
  }
  const root = env.GITHUB_WORKSPACE ?? process.cwd();
  const base = env.BASE_BRANCH ?? 'main';
  const dryRun = env.DRY_RUN === 'true';
  const notice = (message: string) => log(`::notice::${message}`);

  const finished = finishedFolders(root);
  if (finished.length === 0) {
    notice('No spec to archive: every live spec has a task left');
    return;
  }
  const open = foldersWithOpenIssues(repository, gh);
  const start = git(['rev-parse', 'HEAD']).trim();

  for (const folder of finished) {
    if (open.has(folder)) {
      notice(`Not archived: ${folder} still has an open agent issue`);
      continue;
    }
    const branch = archiveBranch(folder);
    const earlier = lines(
      gh([
        'pr',
        'list',
        '--head',
        branch,
        '--state',
        'all',
        '--json',
        'url',
        '--jq',
        '.[].url',
      ]),
    );
    if (earlier.length > 0) {
      notice(`Not archived: ${folder} already has ${earlier[0]}`);
      continue;
    }
    if (dryRun) {
      log(`Would archive ${folder}`);
      continue;
    }

    git(['switch', '--quiet', '--force-create', branch, start]);
    // Every file that names the folder, plus the folder's own Markdown, whose
    // links out of it need one more `../`.
    let naming: string[] = [];
    try {
      naming = lines(git(['grep', '-l', '-I', '-F', folder, '--', '.']));
    } catch {
      // git grep exits 1 when nothing matches.
    }
    const own = lines(git(['ls-files', '--', livePath(folder)]));
    for (const file of new Set([...naming, ...own])) {
      const path = join(root, file);
      const text = readFileSync(path, 'utf8');
      const rewritten = rewriteForArchive(text, file, folder);
      if (rewritten !== text) {
        writeFileSync(path, rewritten);
      }
    }
    mkdirSync(join(root, 'specs', ARCHIVE_FOLDER), { recursive: true });
    git(['mv', livePath(folder), archivedPath(folder)]);
    git(['add', '--all']);
    const title = `chore(specs): archive ${featureName(folder)}`;
    git([
      'commit',
      '--quiet',
      '--message',
      title,
      '--message',
      `Every task in its tasks.md is ticked. Links to and from the folder now name ${archivedPath(folder)}/.`,
    ]);
    git(['push', '--quiet', '--force', 'origin', branch]);
    const url = gh([
      'pr',
      'create',
      '--base',
      base,
      '--head',
      branch,
      '--title',
      title,
      '--body-file',
      bodyFile(prBody(folder)),
    ]).trim();
    notice(`Opened ${url}`);
    git(['switch', '--quiet', '--detach', start]);
  }
};
