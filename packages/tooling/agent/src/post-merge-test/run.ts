/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closedIssue } from '../agent-issues/discover.js';
import { lockAgentIssue } from '../helpers/conversation-lock.js';
import { type IssueSummary, isTrustedIssue } from '../helpers/issue-author.js';
import {
  DEFAULT_TEST_STAGE,
  type DeployJob,
  decide,
  deployedStage,
  MARKER_PREFIX,
  type MergedPullRequest,
  renderIssue,
  TEST_LABEL,
  testedPullRequests,
} from './plan.js';

// Opens a test issue for each pull request a Deploy run put on the test stage.
// Run by .github/workflows/post-merge-verify.yml (through main.ts) when Deploy
// completes, or by hand for one pull request (workflow_dispatch, PR_NUMBER),
// which opens an issue even if one exists. A deploy can carry several merges
// (an earlier one's deploy is skipped once a newer commit is on main), so the
// pull requests are those merged between the stage's previous deploy and this
// one. DRY_RUN=true prints the issues instead of creating them.

export interface Deps {
  env: Record<string, string | undefined>;
  /** Runs the GitHub CLI with these arguments and returns its output. */
  gh: (args: string[]) => string;
  log: (message: string) => void;
}

interface WorkflowRunEvent {
  id: number;
  head_sha: string;
  html_url: string;
  created_at: string;
  conclusion: string | null;
  workflow_id: number;
}

// How far back to look for the stage's previous deploy, and how many merges
// one deploy may carry before the oldest are left out.
const PREVIOUS_RUNS = 30;
const MAX_COMMITS = 50;

const bodyFile = (body: string): string => {
  const file = join(mkdtempSync(join(tmpdir(), 'post-merge-test-')), 'body.md');
  writeFileSync(file, body);
  return file;
};

const json = <T>(text: string): T => JSON.parse(text) as T;

const runJobs = (repository: string, runId: number, gh: Deps['gh']) =>
  json<{ jobs: DeployJob[] }>(
    gh(['api', `repos/${repository}/actions/runs/${runId}/jobs`]),
  ).jobs;

// The commit the stage was deployed at before this run, if a recent Deploy
// run shows one.
const previousDeploy = (
  repository: string,
  current: WorkflowRunEvent,
  stage: string,
  gh: Deps['gh'],
): string | undefined => {
  const { workflow_runs: runs } = json<{
    workflow_runs: { id: number; head_sha: string; created_at: string }[];
  }>(
    gh([
      'api',
      `repos/${repository}/actions/workflows/${current.workflow_id}/runs?status=success&per_page=${PREVIOUS_RUNS}`,
    ]),
  );
  for (const run of runs) {
    if (run.id === current.id || run.created_at >= current.created_at) {
      continue;
    }
    if (deployedStage(runJobs(repository, run.id, gh)) === stage) {
      return run.head_sha;
    }
  }
  return undefined;
};

// The commits on main from `base` (exclusive) to `head`, oldest first; just
// `head` when there is no base, or `head` doesn't follow it (a rollback).
const commitsBetween = (
  repository: string,
  base: string | undefined,
  head: string,
  gh: Deps['gh'],
): string[] => {
  if (!base) {
    return [head];
  }
  if (base === head) {
    return [];
  }
  const compare = json<{ status: string; commits: { sha: string }[] }>(
    gh(['api', `repos/${repository}/compare/${base}...${head}`]),
  );
  if (compare.status !== 'ahead') {
    return [];
  }
  return compare.commits.map((commit) => commit.sha).slice(-MAX_COMMITS);
};

// The pull request that merged as this commit; a commit from a pull request's
// own branch (a merge-commit merge) is not one.
const mergedAs = (
  repository: string,
  sha: string,
  gh: Deps['gh'],
): number | undefined =>
  json<
    { number: number; merged_at: string | null; merge_commit_sha: string }[]
  >(gh(['api', `repos/${repository}/commits/${sha}/pulls`])).find(
    (pr) => pr.merged_at !== null && pr.merge_commit_sha === sha,
  )?.number;

const pullRequest = (number: number, gh: Deps['gh']): MergedPullRequest => {
  const pr = json<{
    number: number;
    title: string;
    url: string;
    labels: { name: string }[];
    files: { path: string }[];
    mergeCommit: { oid: string } | null;
    body: string | null;
  }>(
    gh([
      'pr',
      'view',
      String(number),
      '--json',
      'number,title,url,labels,files,mergeCommit,body',
    ]),
  );
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    labels: pr.labels.map((label) => label.name),
    files: pr.files.map((file) => file.path),
    mergeCommit: pr.mergeCommit?.oid ?? '',
    closingIssues: [closedIssue(pr.body)].filter(
      (n): n is number => n !== undefined,
    ),
  };
};

// The body of every issue that carries a test marker, open or closed, and was
// opened by this workflow or someone with write access: anyone can open an
// issue, and a marker in a stranger's must not stop a pull request being
// tested. One JSON object per line.
const markedIssueBodies = (repository: string, gh: Deps['gh']): string[] =>
  gh([
    'api',
    `repos/${repository}/issues?state=all&per_page=100`,
    '--paginate',
    '--jq',
    `.[] | select(.pull_request == null) | select((.body // "") | contains("${MARKER_PREFIX}")) | {body, author: .user.login, association: .author_association} | @json`,
  ])
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as IssueSummary)
    .filter(isTrustedIssue)
    .map((issue) => issue.body);

const ensureLabel = (gh: Deps['gh']): void => {
  try {
    gh([
      'label',
      'create',
      TEST_LABEL,
      '--color',
      '0E8A16',
      '--description',
      'Test a merged pull request on the deployed development stage',
    ]);
  } catch {
    // Already there.
  }
};

export const run = (deps: Deps): void => {
  const { env, gh, log } = deps;
  const notice = (message: string) => log(`::notice::${message}`);
  const repository = env.GITHUB_REPOSITORY;
  if (!repository) {
    throw new Error('GITHUB_REPOSITORY must be set');
  }
  const dryRun = env.DRY_RUN === 'true';
  const testStage = env.TEST_STAGE || DEFAULT_TEST_STAGE;

  let stage: string;
  let deployedSha: string;
  let deployRunUrl: string | undefined;
  let numbers: number[];
  let force = false;
  if (env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    const number = Number((env.PR_NUMBER ?? '').trim().replace(/^#/, ''));
    if (!Number.isInteger(number) || number <= 0) {
      throw new Error('PR_NUMBER must be a pull request number, e.g. 634');
    }
    stage = testStage;
    numbers = [number];
    deployedSha = '';
    force = true;
  } else {
    if (!env.GITHUB_EVENT_PATH) {
      throw new Error('GITHUB_EVENT_PATH must be set');
    }
    const event = json<{ workflow_run: WorkflowRunEvent }>(
      readFileSync(env.GITHUB_EVENT_PATH, 'utf8'),
    ).workflow_run;
    if (event.conclusion !== 'success') {
      notice(
        `No test issue: the Deploy run ${event.conclusion ?? 'did not finish'}`,
      );
      return;
    }
    const deployed = deployedStage(runJobs(repository, event.id, gh));
    if (deployed !== testStage) {
      notice(
        deployed
          ? `No test issue: the run deployed ${deployed}, not ${testStage}`
          : "No test issue: the run deployed nothing (its commit was no longer main's latest)",
      );
      return;
    }
    stage = deployed;
    deployedSha = event.head_sha;
    deployRunUrl = event.html_url;
    const base = previousDeploy(repository, event, stage, gh);
    const commits = commitsBetween(repository, base, deployedSha, gh);
    numbers = [
      ...new Set(
        commits
          .map((sha) => mergedAs(repository, sha, gh))
          .filter((n): n is number => n !== undefined),
      ),
    ];
    if (numbers.length === 0) {
      notice(
        `No test issue: no merged pull request between ${base ?? '(none)'} and ${deployedSha}`,
      );
      return;
    }
  }

  const tested = force
    ? new Set<number>()
    : testedPullRequests(markedIssueBodies(repository, gh));
  if (!dryRun) {
    ensureLabel(gh);
  }

  // Issues opened but not handed to the agent, because something they point
  // at could not be locked. The run fails for them: nobody reads its warnings.
  const notHandedOver: string[] = [];
  for (const number of numbers) {
    const pr = pullRequest(number, gh);
    if (!force) {
      const decision = decide(pr, tested);
      if (!decision.test) {
        notice(`No test issue: ${decision.reason}`);
        continue;
      }
    }
    const issue = renderIssue({
      pr,
      stage,
      deployedSha: deployedSha || pr.mergeCommit,
      deployRunUrl,
    });
    if (dryRun) {
      log(`${issue.title}\n\n${issue.body}`);
      continue;
    }
    const url = gh([
      'issue',
      'create',
      '--title',
      issue.title,
      '--body-file',
      bodyFile(issue.body),
    ]).trim();
    notice(`Created ${url} to test #${number}`);
    // The agent reads the issue, the pull request it tests and the issues
    // that pull request closes.
    const handedOver = lockAgentIssue({
      repository,
      issueUrl: url,
      label: TEST_LABEL,
      alsoLock: [number, ...pr.closingIssues],
      gh,
      log,
    });
    if (!handedOver) {
      notHandedOver.push(url);
    }
  }
  if (notHandedOver.length > 0) {
    throw new Error(
      `Not handed to the test agent: ${notHandedOver.join(', ')}. Lock what the warnings above name, then add the ${TEST_LABEL} label by hand`,
    );
  }
};
