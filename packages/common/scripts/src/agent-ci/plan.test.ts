/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  attemptsUsed,
  type CiRun,
  MAX_CI_FIX_ATTEMPTS,
  type PullRequestState,
  planCi,
} from './plan.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';

const run = (overrides: Partial<CiRun> = {}): CiRun => ({
  event: 'pull_request',
  conclusion: 'failure',
  headBranch: 'openhands/issue-308',
  headSha: SHA,
  ...overrides,
});

const pr = (overrides: Partial<PullRequestState> = {}): PullRequestState => ({
  open: true,
  headSha: SHA,
  labels: [],
  reviewStatus: undefined,
  ...overrides,
});

describe('attemptsUsed', () => {
  it('is the highest attempt label, ignoring other labels', () => {
    expect(attemptsUsed([])).toBe(0);
    expect(attemptsUsed(['openhands', 'ci-fix-1'])).toBe(1);
    expect(attemptsUsed(['ci-fix-2', 'ci-fix-1', 'ci-fix-exhausted'])).toBe(2);
    expect(attemptsUsed(['ci-fix-x', 'xci-fix-3'])).toBe(0);
  });
});

describe('planCi', () => {
  it('sends the agent back after a failed run, naming the failing jobs', () => {
    const plan = planCi(run(), pr(), ['Checks (test)', 'E2E tests']);
    expect(plan).toEqual({
      action: 'send-back',
      attempt: 1,
      label: 'ci-fix-1',
      description: 'CI failed (fix attempt 1 of 3): Checks (test), E2E tests',
    });
  });

  it('counts a timed out run as a failure', () => {
    expect(planCi(run({ conclusion: 'timed_out' }), pr(), []).action).toBe(
      'send-back',
    );
  });

  it('uses the next attempt number', () => {
    expect(planCi(run(), pr({ labels: ['ci-fix-1'] }), ['x'])).toMatchObject({
      action: 'send-back',
      attempt: 2,
      label: 'ci-fix-2',
    });
  });

  it('keeps the description within the 140 characters GitHub allows', () => {
    const plan = planCi(run(), pr(), ['a'.repeat(300)]);
    expect(plan.action === 'send-back' && plan.description.length).toBe(140);
  });

  it('says to see the run when no failing job could be named', () => {
    expect(planCi(run(), pr(), [])).toMatchObject({
      description: 'CI failed (fix attempt 1 of 3): see the run',
    });
  });

  it('gives up once, after the last attempt', () => {
    const labels = [`ci-fix-${MAX_CI_FIX_ATTEMPTS}`];
    const plan = planCi(run(), pr({ labels }), ['Checks (test)']);
    expect(plan.action).toBe('give-up');
    expect(plan.action === 'give-up' && plan.comment).toContain(
      'A person needs to take over',
    );
    expect(
      planCi(run(), pr({ labels: [...labels, 'ci-fix-exhausted'] }), ['x']),
    ).toEqual({
      action: 'ignore',
      reason: 'already gave up on this pull request',
    });
  });

  it.each(['success', 'cancelled', 'skipped', 'neutral', null])(
    'does not answer a run that %s',
    (conclusion) => {
      expect(planCi(run({ conclusion }), pr(), []).action).toBe('ignore');
    },
  );

  it('ignores branches that are not an agent issue branch', () => {
    for (const headBranch of [
      'feature/x',
      'openhands/issue-308-2',
      'openhands/issue-',
      'xopenhands/issue-1',
      'openhands/issue-1/../x',
    ]) {
      expect(planCi(run({ headBranch }), pr(), []).action).toBe('ignore');
    }
  });

  it('ignores runs that were not for a pull request', () => {
    expect(planCi(run({ event: 'push' }), pr(), []).action).toBe('ignore');
  });

  it('ignores a closed pull request', () => {
    expect(planCi(run(), pr({ open: false }), []).action).toBe('ignore');
  });

  it('ignores a run for a commit the pull request has moved past', () => {
    expect(planCi(run(), pr({ headSha: 'f'.repeat(40) }), []).action).toBe(
      'ignore',
    );
  });

  it('does not use another attempt when the same commit is re-run', () => {
    for (const reviewStatus of ['failure', 'error']) {
      expect(planCi(run(), pr({ reviewStatus }), []).action).toBe('ignore');
    }
    expect(planCi(run(), pr({ reviewStatus: 'success' }), []).action).toBe(
      'send-back',
    );
  });
});
