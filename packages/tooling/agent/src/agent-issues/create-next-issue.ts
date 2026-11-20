/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closedIssue, specFolders } from './discover.js';
import { decide } from './gate.js';
import {
  AGENT_LABEL,
  isSpecFolderName,
  MARKER_PREFIX,
  markerFolder,
} from './issue.js';
import { planIssue } from './plan-issue.js';
import { formatProblem, validateTasks } from './validate.js';

// Opens the next implementation issue for the implementing agent. Run by
// .github/workflows/agent-issues.yml (through main.ts) when a pull request
// merges, or by hand for one spec folder (workflow_dispatch, SPEC_FOLDER).
// See gate.ts for which merges count and tasks.ts for how a feature is split
// into issues. DRY_RUN=true prints the issue instead of creating it.

export interface Deps {
  env: Record<string, string | undefined>;
  /** Runs the GitHub CLI with these arguments and returns its output. */
  gh: (args: string[]) => string;
  log: (message: string) => void;
}

interface PullRequestEvent {
  number: number;
  body: string | null;
  merged: boolean;
  labels: { name: string }[];
  head: { ref: string };
}

const bodyFile = (body: string): string => {
  const file = join(mkdtempSync(join(tmpdir(), 'agent-issue-')), 'body.md');
  writeFileSync(file, body);
  return file;
};

// The spec folders a merged pull request is about: the one its agent issue
// named, else the ones it changed. Undefined when the merge doesn't count.
const foldersForPullRequest = (
  pr: PullRequestEvent,
  repository: string,
  { gh, log }: Deps,
): string[] | undefined => {
  const decision = decide({
    merged: pr.merged === true,
    labels: pr.labels.map((label) => label.name),
    headRef: pr.head.ref,
  });
  if (decision.kind === 'ignore') {
    log(`::notice::No issue created: ${decision.reason}`);
    return undefined;
  }
  const linked = closedIssue(pr.body);
  if (decision.kind === 'implementation' && linked !== undefined) {
    // "Closes #n" is the agent's prose: the number may be no issue at all, so
    // a failed lookup falls back to the changed files like a missing marker.
    let body: string | null = null;
    try {
      ({ body } = JSON.parse(
        gh(['issue', 'view', String(linked), '--json', 'body']),
      ) as { body: string | null });
    } catch {
      log(`::notice::Could not read issue #${linked}; using the changed files`);
    }
    const folder = markerFolder(body ?? '');
    if (folder) {
      return [folder];
    }
  }
  const files = gh([
    'api',
    `repos/${repository}/pulls/${pr.number}/files`,
    '--paginate',
    '--jq',
    '.[].filename',
  ])
    .split('\n')
    .filter(Boolean);
  return specFolders(files);
};

// The body of every issue that carries a marker: open or closed, and whether
// or not it still has the agent's label (removing it is how a run is stopped
// or repeated). One JSON string per line.
const markedIssueBodies = (repository: string, gh: Deps['gh']): string[] =>
  gh([
    'api',
    `repos/${repository}/issues?state=all&per_page=100`,
    '--paginate',
    '--jq',
    `.[] | select(.pull_request == null) | (.body // "") | select(contains("${MARKER_PREFIX}")) | @json`,
  ])
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string);

export const run = (deps: Deps): void => {
  const { env, gh, log } = deps;
  const repository = env.GITHUB_REPOSITORY;
  if (!repository) {
    throw new Error('GITHUB_REPOSITORY must be set');
  }
  const root = env.GITHUB_WORKSPACE ?? process.cwd();
  const dryRun = env.DRY_RUN === 'true';
  const notice = (message: string) => log(`::notice::${message}`);

  let folders: string[];
  let prNumber: number | undefined;
  if (env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    // By hand, for one folder: a spec merged without its label, or a chain
    // that stalled and has been sorted out.
    const folder = (env.SPEC_FOLDER ?? '')
      .trim()
      .replace(/^specs\//, '')
      .replace(/\/$/, '');
    if (!isSpecFolderName(folder)) {
      throw new Error(
        'SPEC_FOLDER must be the name of a folder under specs/, e.g. 20261114-120542-assignment-submissions',
      );
    }
    folders = [folder];
  } else {
    if (!env.GITHUB_EVENT_PATH) {
      throw new Error('GITHUB_EVENT_PATH must be set');
    }
    const pr = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
      .pull_request as PullRequestEvent;
    const found = foldersForPullRequest(pr, repository, deps);
    if (!found) {
      return;
    }
    folders = found;
    prNumber = pr.number;
  }

  const withTasks = folders.filter((folder) =>
    existsSync(join(root, 'specs', folder, 'tasks.md')),
  );
  if (withTasks.length === 0) {
    notice('No issue created: no spec folder with a tasks.md was found');
    return;
  }

  const templateMd = readFileSync(
    join(root, '.github/ISSUE_TEMPLATE/implement-phase.md'),
    'utf8',
  );
  const existingIssueBodies = markedIssueBodies(repository, gh);

  // Folders whose tasks.md the reader would misread. PR checks should have
  // stopped them; opening an issue from one would hand the agent the wrong
  // tasks, so the run fails instead.
  const unreadable: string[] = [];
  for (const folder of withTasks) {
    const read = (file: string) =>
      readFileSync(join(root, 'specs', folder, file), 'utf8');
    const tasksMd = read('tasks.md');
    const problems = validateTasks(tasksMd);
    if (problems.length > 0) {
      for (const problem of problems) {
        log(formatProblem(`specs/${folder}/tasks.md`, problem, true));
      }
      unreadable.push(folder);
      continue;
    }
    const plan = planIssue({
      folder,
      tasksMd,
      specMd: read('spec.md'),
      templateMd,
      existingIssueBodies,
    });
    if (plan.action === 'done') {
      notice(`No issue created: ${plan.reason}`);
      continue;
    }
    if (plan.action === 'stalled') {
      notice(`No issue created: ${plan.reason}`);
      // Said on the pull request too: nobody reads a workflow's notices.
      if (prNumber !== undefined && !dryRun) {
        gh([
          'pr',
          'comment',
          String(prNumber),
          '--body-file',
          bodyFile(
            [
              `The next implementation issue for \`specs/${folder}/\` was not opened: an issue for "${plan.title}" already exists, and these tasks in its \`tasks.md\` are not ticked: ${plan.unticked.join(', ')}.`,
              '',
              'Tick them if they are done, or finish them. Then run the **Agent Issues** workflow by hand with this spec folder to open the next issue.',
              '',
            ].join('\n'),
          ),
        ]);
      }
      continue;
    }
    if (dryRun) {
      log(`${plan.issue.title}\n\n${plan.issue.body}`);
      continue;
    }
    const url = gh([
      'issue',
      'create',
      '--title',
      plan.issue.title,
      '--body-file',
      bodyFile(plan.issue.body),
      '--label',
      AGENT_LABEL,
    ]).trim();
    notice(`Created ${url}`);
  }
  if (unreadable.length > 0) {
    throw new Error(
      `No issue created for ${unreadable.join(', ')}: tasks.md is not in the format the workflow reads (see the errors above)`,
    );
  }
};
