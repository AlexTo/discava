/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  attemptsUsed,
  MAX_REVIEW_FIX_ATTEMPTS,
  type PullRequestState,
  planReview,
  type ReviewEvent,
} from './plan.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const BODY = [
  '<!-- openhands-review-run: 0756e0b0 -->',
  '**Blocking** 1. thing',
  '',
  '🔄 CHANGES REQUESTED',
  '',
  'LLM profile: `unknown`',
].join('\n');

const review = (overrides: Partial<ReviewEvent> = {}): ReviewEvent => ({
  action: 'submitted',
  body: BODY,
  commitSha: SHA,
  authorAssociation: 'OWNER',
  headBranch: 'openhands/issue-361',
  ...overrides,
});

const pr = (overrides: Partial<PullRequestState> = {}): PullRequestState => ({
  open: true,
  headSha: SHA,
  labels: [],
  reviewStatus: undefined,
  ...overrides,
});

const ignored = (plan: ReturnType<typeof planReview>) =>
  plan.action === 'ignore';

describe('attemptsUsed', () => {
  it('counts review-fix labels only, not ci-fix ones', () => {
    expect(attemptsUsed([])).toBe(0);
    expect(attemptsUsed(['ci-fix-3', 'review-fix-1'])).toBe(1);
    expect(
      attemptsUsed(['review-fix-2', 'review-fix-1', 'review-fix-exhausted']),
    ).toBe(2);
  });
});

describe('planReview', () => {
  it('sends the agent back, counting attempt one', () => {
    const plan = planReview(review(), pr());
    expect(plan).toMatchObject({
      action: 'send-back',
      attempt: 1,
      label: 'review-fix-1',
    });
    if (plan.action === 'send-back') {
      expect(plan.description.length).toBeLessThanOrEqual(140);
    }
  });

  it('uses the next attempt, independent of ci-fix labels', () => {
    expect(
      planReview(review(), pr({ labels: ['ci-fix-3', 'review-fix-1'] })),
    ).toMatchObject({ attempt: 2, label: 'review-fix-2' });
  });

  it("ignores branches that are not the agent's", () => {
    expect(ignored(planReview(review({ headBranch: 'feat/x' }), pr()))).toBe(
      true,
    );
    expect(
      ignored(planReview(review({ headBranch: 'openhands/a/b' }), pr())),
    ).toBe(true);
  });

  it("ignores reviews that are approvals, not the reviewer's, or from outsiders", () => {
    expect(
      ignored(
        planReview(
          review({ body: BODY.replace('🔄 CHANGES REQUESTED', '✅ APPROVED') }),
          pr(),
        ),
      ),
    ).toBe(true);
    expect(
      ignored(
        planReview(review({ body: BODY.replace(/<!--.*-->/, '') }), pr()),
      ),
    ).toBe(true);
    expect(
      ignored(planReview(review({ authorAssociation: 'NONE' }), pr())),
    ).toBe(true);
  });

  it('ignores a verdict that is only quoted mid-line', () => {
    expect(
      ignored(
        planReview(
          review({
            body: '<!-- openhands-review-run: x -->\nnot 🔄 CHANGES REQUESTED yet',
          }),
          pr(),
        ),
      ),
    ).toBe(true);
  });

  it('ignores edits, closed pull requests and stale heads', () => {
    expect(ignored(planReview(review({ action: 'edited' }), pr()))).toBe(true);
    expect(ignored(planReview(review(), pr({ open: false })))).toBe(true);
    expect(ignored(planReview(review(), pr({ headSha: 'f'.repeat(40) })))).toBe(
      true,
    );
  });

  it('does not spend another attempt on a commit already sent back', () => {
    expect(ignored(planReview(review(), pr({ reviewStatus: 'failure' })))).toBe(
      true,
    );
  });

  it('gives up once, after the limit', () => {
    const labels = Array.from(
      { length: MAX_REVIEW_FIX_ATTEMPTS },
      (_, i) => `review-fix-${i + 1}`,
    );
    expect(planReview(review(), pr({ labels }))).toMatchObject({
      action: 'give-up',
    });
    expect(
      ignored(
        planReview(
          review(),
          pr({ labels: [...labels, 'review-fix-exhausted'] }),
        ),
      ),
    ).toBe(true);
  });
});
