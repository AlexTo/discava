/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// Which merged pull requests may start an implementation issue. Not any PR:
// the agent's own PRs tick boxes in tasks.md, so a path filter on `specs/**`
// would loop. A spec PR must be labelled, deliberately, by a person.

export const SPEC_READY_LABEL = 'spec-ready';
export const AGENT_BRANCH_PREFIX = 'openhands/';

export interface MergedPullRequest {
  merged: boolean;
  labels: string[];
  headRef: string;
}

export type Decision =
  | { kind: 'spec' | 'implementation' }
  | { kind: 'ignore'; reason: string };

export const decide = (pr: MergedPullRequest): Decision => {
  if (!pr.merged) {
    return {
      kind: 'ignore',
      reason: 'the pull request was closed, not merged',
    };
  }
  if (pr.headRef.startsWith(AGENT_BRANCH_PREFIX)) {
    return { kind: 'implementation' };
  }
  if (pr.labels.includes(SPEC_READY_LABEL)) {
    return { kind: 'spec' };
  }
  return {
    kind: 'ignore',
    reason: `it is not an agent branch and has no "${SPEC_READY_LABEL}" label`,
  };
};
