/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// What to do when the PR Checks workflow finishes on an agent's pull request.
// The Issue-to-PR automation sends its agent back to revise a pull request
// whose latest commit carries a `software-factory/review` status in state
// `failure` or `error` (worker.py in the automation's package). Nothing in
// this repository set that status, so a failing CI run went unanswered. This
// turns a failed CI run into that status, a limited number of times per pull
// request, so the agent is sent back with the failing checks.

export const REVIEW_STATUS_CONTEXT = 'software-factory/review';
export const MAX_CI_FIX_ATTEMPTS = 3;
export const ATTEMPT_LABEL_PREFIX = 'ci-fix-';
export const EXHAUSTED_LABEL = 'ci-fix-exhausted';

// The automation only revises a pull request whose branch is exactly
// `<branch prefix>-<issue number>`; a second branch for a re-run
// (`openhands/issue-308-2`) is never revised, so it is not answered either.
export const AGENT_BRANCH = /^openhands\/issue-\d+$/;

// GitHub refuses a status description over 140 characters.
const MAX_DESCRIPTION = 140;

export interface CiRun {
  event: string;
  conclusion: string | null;
  headBranch: string;
  headSha: string;
}

export interface PullRequestState {
  open: boolean;
  /** The pull request's current head, which may have moved since the run. */
  headSha: string;
  labels: string[];
  /** The state of the review status on `CiRun.headSha`, if it has one. */
  reviewStatus: string | undefined;
}

export type CiPlan =
  | { action: 'ignore'; reason: string }
  | {
      action: 'send-back';
      attempt: number;
      label: string;
      description: string;
    }
  | { action: 'give-up'; comment: string };

export const attemptsUsed = (labels: string[]): number =>
  Math.max(
    0,
    ...labels.map((label) => {
      const match = new RegExp(`^${ATTEMPT_LABEL_PREFIX}(\\d+)$`).exec(label);
      return match ? Number(match[1]) : 0;
    }),
  );

const describeFailure = (attempt: number, failedJobs: string[]): string => {
  const jobs = failedJobs.length > 0 ? failedJobs.join(', ') : 'see the run';
  const text = `CI failed (fix attempt ${attempt} of ${MAX_CI_FIX_ATTEMPTS}): ${jobs}`;
  return text.length <= MAX_DESCRIPTION
    ? text
    : `${text.slice(0, MAX_DESCRIPTION - 1)}…`;
};

export const planCi = (
  run: CiRun,
  pr: PullRequestState,
  failedJobs: string[],
): CiPlan => {
  if (!AGENT_BRANCH.test(run.headBranch)) {
    return { action: 'ignore', reason: 'not an agent branch' };
  }
  if (run.event !== 'pull_request') {
    return { action: 'ignore', reason: 'the run was not for a pull request' };
  }
  // Only a failure is answered. A passing run needs no status: the next
  // commit starts without one, so the automation leaves the pull request
  // alone, and a green "review" status would suggest a review that never
  // happened.
  if (run.conclusion !== 'failure' && run.conclusion !== 'timed_out') {
    return {
      action: 'ignore',
      reason: `the run ${run.conclusion ?? 'has no result'}`,
    };
  }
  if (!pr.open) {
    return { action: 'ignore', reason: 'the pull request is not open' };
  }
  if (pr.headSha !== run.headSha) {
    return {
      action: 'ignore',
      reason: 'the pull request has a newer commit than this run',
    };
  }
  // A re-run of the same commit's checks must not use another attempt.
  if (pr.reviewStatus === 'failure' || pr.reviewStatus === 'error') {
    return {
      action: 'ignore',
      reason: 'this commit was already sent back for a failed run',
    };
  }
  const used = attemptsUsed(pr.labels);
  if (used >= MAX_CI_FIX_ATTEMPTS) {
    if (pr.labels.includes(EXHAUSTED_LABEL)) {
      return {
        action: 'ignore',
        reason: 'already gave up on this pull request',
      };
    }
    return {
      action: 'give-up',
      comment: [
        `CI is still failing after ${MAX_CI_FIX_ATTEMPTS} automatic fix attempts, so the agent will not be sent back again.`,
        '',
        failedJobs.length > 0
          ? `Failing checks on \`${run.headSha.slice(0, 7)}\`: ${failedJobs.join(', ')}.`
          : `See the failed run for \`${run.headSha.slice(0, 7)}\`.`,
        '',
        `A person needs to take over this pull request. To let the agent try again, remove the \`${ATTEMPT_LABEL_PREFIX}*\` and \`${EXHAUSTED_LABEL}\` labels and re-run the checks.`,
      ].join('\n'),
    };
  }
  const attempt = used + 1;
  return {
    action: 'send-back',
    attempt,
    label: `${ATTEMPT_LABEL_PREFIX}${attempt}`,
    description: describeFailure(attempt, failedJobs),
  };
};
