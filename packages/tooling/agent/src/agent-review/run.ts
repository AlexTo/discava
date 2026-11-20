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
  planReview,
  REVIEW_STATUS_CONTEXT,
} from './plan.js';

// Run by .github/workflows/agent-review.yml when a review is submitted.
// DRY_RUN=true prints what it would do and changes nothing.

export interface Deps {
  env: Record<string, string | undefined>;
  /** Runs the GitHub CLI with these arguments and returns its output. */
  gh: (args: string[]) => string;
  log: (message: string) => void;
}

interface ReviewEventPayload {
  action: string;
  review: {
    body: string | null;
    commit_id: string;
    author_association: string;
    html_url: string;
  };
  pull_request: { number: number; head: { ref: string } };
}

const bodyFile = (body: string): string => {
  const file = join(mkdtempSync(join(tmpdir(), 'agent-review-')), 'body.md');
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
  const event = JSON.parse(
    readFileSync(env.GITHUB_EVENT_PATH, 'utf8'),
  ) as ReviewEventPayload;
  const number = event.pull_request.number;

  // Checked before anything is looked up: the branch name comes from the
  // pull request's author.
  if (!AGENT_BRANCH.test(event.pull_request.head.ref)) {
    notice('Nothing to do: not an agent branch');
    return;
  }

  const pr = JSON.parse(gh(['api', `repos/${repository}/pulls/${number}`])) as {
    state: string;
    head: { sha: string };
    labels: { name: string }[];
  };
  const statuses = JSON.parse(
    gh([
      'api',
      `repos/${repository}/commits/${event.review.commit_id}/statuses`,
    ]),
  ) as { context: string; state: string }[];

  const plan = planReview(
    {
      action: event.action,
      body: event.review.body ?? '',
      commitSha: event.review.commit_id,
      authorAssociation: event.review.author_association,
      headBranch: event.pull_request.head.ref,
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
  // The label first: if the status then fails to post, the next review
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
    `repos/${repository}/statuses/${event.review.commit_id}`,
    '-f',
    'state=failure',
    '-f',
    `context=${REVIEW_STATUS_CONTEXT}`,
    '-f',
    `description=${plan.description}`,
    '-f',
    `target_url=${event.review.html_url}`,
  ]);
  notice(
    `Sent #${number} back to the agent (fix attempt ${plan.attempt}): ${plan.description}`,
  );
};
