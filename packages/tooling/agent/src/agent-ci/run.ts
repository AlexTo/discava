/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AGENT_BRANCH,
  EXHAUSTED_LABEL,
  planCi,
  REVIEW_STATUS_CONTEXT,
} from './plan.js';

// Run by .github/workflows/agent-ci.yml when the PR Checks workflow finishes.
// DRY_RUN=true prints what it would do and changes nothing.

export interface Deps {
  env: Record<string, string | undefined>;
  /** Runs the GitHub CLI with these arguments and returns its output. */
  gh: (args: string[]) => string;
  log: (message: string) => void;
}

interface WorkflowRun {
  id: number;
  event: string;
  conclusion: string | null;
  head_branch: string;
  head_sha: string;
  html_url: string;
  pull_requests?: { number: number }[];
}

const bodyFile = (body: string): string => {
  const file = join(mkdtempSync(join(tmpdir(), 'agent-ci-')), 'body.md');
  writeFileSync(file, body);
  return file;
};

export const run = ({ env, gh, log }: Deps): void => {
  const repository = env.GITHUB_REPOSITORY;
  if (!repository || !env.GITHUB_EVENT_PATH) {
    throw new Error('GITHUB_REPOSITORY and GITHUB_EVENT_PATH must be set');
  }
  const dryRun = env.DRY_RUN === 'true';
  const notice = (message: string) => log(`::notice::${message}`);
  const workflowRun = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
    .workflow_run as WorkflowRun;

  // Checked before anything is looked up, and before the branch name is used
  // in a request: it comes from the pull request's author.
  if (!AGENT_BRANCH.test(workflowRun.head_branch)) {
    notice('Nothing to do: not an agent branch');
    return;
  }

  let number = workflowRun.pull_requests?.[0]?.number;
  if (number === undefined) {
    const owner = repository.split('/')[0];
    const found = gh([
      'api',
      `repos/${repository}/pulls?state=open&head=${owner}:${workflowRun.head_branch}`,
      '--jq',
      '.[0].number // empty',
    ]).trim();
    number = found ? Number(found) : undefined;
  }
  if (number === undefined) {
    notice('Nothing to do: no open pull request for this branch');
    return;
  }

  const pr = JSON.parse(gh(['api', `repos/${repository}/pulls/${number}`])) as {
    state: string;
    head: { sha: string };
    labels: { name: string }[];
  };
  const statuses = JSON.parse(
    gh(['api', `repos/${repository}/commits/${workflowRun.head_sha}/statuses`]),
  ) as { context: string; state: string }[];
  const failedJobs =
    workflowRun.conclusion === 'failure' ||
    workflowRun.conclusion === 'timed_out'
      ? gh([
          'api',
          `repos/${repository}/actions/runs/${workflowRun.id}/jobs?per_page=100`,
          '--jq',
          '.jobs[] | select(.conclusion == "failure" or .conclusion == "timed_out") | .name',
        ])
          .split('\n')
          .filter(Boolean)
      : [];

  const plan = planCi(
    {
      event: workflowRun.event,
      conclusion: workflowRun.conclusion,
      headBranch: workflowRun.head_branch,
      headSha: workflowRun.head_sha,
    },
    {
      open: pr.state === 'open',
      headSha: pr.head.sha,
      labels: pr.labels.map((label) => label.name),
      // The newest status for the context comes first.
      reviewStatus: statuses.find(
        (status) => status.context === REVIEW_STATUS_CONTEXT,
      )?.state,
    },
    failedJobs,
  );

  if (plan.action === 'ignore') {
    notice(`Nothing to do for #${number}: ${plan.reason}`);
    return;
  }
  if (dryRun) {
    log(JSON.stringify({ pullRequest: number, plan }, null, 2));
    return;
  }
  if (plan.action === 'give-up') {
    gh([
      'api',
      '-X',
      'POST',
      `repos/${repository}/issues/${number}/labels`,
      '-f',
      `labels[]=${EXHAUSTED_LABEL}`,
    ]);
    gh([
      'api',
      '-X',
      'POST',
      `repos/${repository}/issues/${number}/comments`,
      '-F',
      `body=@${bodyFile(plan.comment)}`,
    ]);
    notice(`Gave up on #${number} after the attempt limit`);
    return;
  }
  // The label first: if the status then fails to post, the next failed run
  // counts one more attempt instead of repeating this one for ever.
  gh([
    'api',
    '-X',
    'POST',
    `repos/${repository}/issues/${number}/labels`,
    '-f',
    `labels[]=${plan.label}`,
  ]);
  gh([
    'api',
    '-X',
    'POST',
    `repos/${repository}/statuses/${workflowRun.head_sha}`,
    '-f',
    'state=failure',
    '-f',
    `context=${REVIEW_STATUS_CONTEXT}`,
    '-f',
    `description=${plan.description}`,
    '-f',
    `target_url=${workflowRun.html_url}`,
  ]);
  notice(
    `Sent #${number} back to the agent (fix attempt ${plan.attempt}): ${plan.description}`,
  );
};
