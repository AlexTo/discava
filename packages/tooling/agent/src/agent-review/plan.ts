/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// What to do when the OpenHands reviewer submits a review on an agent's pull
// request. The Issue-to-PR automation sends its agent back to revise a pull
// request whose latest commit carries a `software-factory/review` status in
// state `failure` or `error`. The reviewer ends its review with a verdict
// line but sets no status; this turns that verdict into the status, a limited
// number of times per pull request.
// The reviewer re-reviews on its own once the agent pushes: its scan treats a
// new head commit as a new review.

import { AGENT_BRANCH, REVIEW_STATUS_CONTEXT } from '../agent-ci/plan.js';

export { AGENT_BRANCH, REVIEW_STATUS_CONTEXT };
export const MAX_REVIEW_FIX_ATTEMPTS = 5;
export const ATTEMPT_LABEL_PREFIX = 'review-fix-';
export const EXHAUSTED_LABEL = 'review-fix-exhausted';

// Every review the reviewer posts carries this marker, so a person's own
// review that quotes the verdict is not mistaken for it.
export const REVIEW_RUN_MARKER = /<!-- openhands-review-run: [^>]*-->/;
// The verdict ends the review's text, before a provenance footer.
export const CHANGES_REQUESTED = /^🔄 CHANGES REQUESTED\s*$/m;
// Only people with write access make a review that counts, and the GitHub App
// the reviewer agent posts as, if the repository names one (the
// `AGENT_APP_LOGIN` variable): GitHub gives an app the association NONE.
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

// GitHub refuses a status description over 140 characters.
const MAX_DESCRIPTION = 140;

export interface ReviewEvent {
  action: string;
  body: string;
  commitSha: string;
  /** The reviewer's login. */
  author: string;
  authorAssociation: string;
  headBranch: string;
}

export interface PullRequestState {
  open: boolean;
  /** The pull request's current head, which may have moved since the review. */
  headSha: string;
  labels: string[];
  /** The state of the review status on `ReviewEvent.commitSha`, if it has one. */
  reviewStatus: string | undefined;
}

export type ReviewPlan =
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

const describe = (attempt: number): string => {
  const text = `Review requested changes (fix attempt ${attempt} of ${MAX_REVIEW_FIX_ATTEMPTS}): see the review`;
  return text.length <= MAX_DESCRIPTION
    ? text
    : `${text.slice(0, MAX_DESCRIPTION - 1)}…`;
};

/** Whether a review's author can send the agent back. */
const isTrustedReviewer = (review: ReviewEvent, agentApp?: string): boolean =>
  TRUSTED.has(review.authorAssociation) ||
  // Only an app's login ends in `[bot]`, so a person can't take this one.
  (!!agentApp?.endsWith('[bot]') && review.author === agentApp);

/**
 * @param agentApp the login of the GitHub App the reviewer agent posts as,
 * such as `my-agent[bot]`; without one, only people with write access count.
 */
export const planReview = (
  review: ReviewEvent,
  pr: PullRequestState,
  agentApp?: string,
): ReviewPlan => {
  if (!AGENT_BRANCH.test(review.headBranch)) {
    return { action: 'ignore', reason: 'not an agent branch' };
  }
  if (review.action !== 'submitted') {
    return { action: 'ignore', reason: 'the review was not newly submitted' };
  }
  if (!isTrustedReviewer(review, agentApp)) {
    return {
      action: 'ignore',
      reason: "the review is not from a maintainer or the agent's app",
    };
  }
  if (!REVIEW_RUN_MARKER.test(review.body)) {
    return { action: 'ignore', reason: 'not a review by the reviewer agent' };
  }
  if (!CHANGES_REQUESTED.test(review.body)) {
    return { action: 'ignore', reason: 'the review did not request changes' };
  }
  if (!pr.open) {
    return { action: 'ignore', reason: 'the pull request is not open' };
  }
  if (pr.headSha !== review.commitSha) {
    return {
      action: 'ignore',
      reason: 'the pull request has a newer commit than this review',
    };
  }
  // A second review of the same commit must not use another attempt.
  if (pr.reviewStatus === 'failure' || pr.reviewStatus === 'error') {
    return {
      action: 'ignore',
      reason: 'this commit was already sent back',
    };
  }
  const used = attemptsUsed(pr.labels);
  if (used >= MAX_REVIEW_FIX_ATTEMPTS) {
    if (pr.labels.includes(EXHAUSTED_LABEL)) {
      return {
        action: 'ignore',
        reason: 'already gave up on this pull request',
      };
    }
    return {
      action: 'give-up',
      comment: [
        `The reviewer still requests changes after ${MAX_REVIEW_FIX_ATTEMPTS} automatic fix attempts, so the agent will not be sent back again.`,
        '',
        `A person needs to take over this pull request. To let the agent try again, remove the \`${ATTEMPT_LABEL_PREFIX}*\` and \`${EXHAUSTED_LABEL}\` labels and dismiss or re-request the review.`,
      ].join('\n'),
    };
  }
  const attempt = used + 1;
  return {
    action: 'send-back',
    attempt,
    label: `${ATTEMPT_LABEL_PREFIX}${attempt}`,
    description: describe(attempt),
  };
};
