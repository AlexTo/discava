/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { AGENT_LABEL } from '../agent-issues/issue.js';
import { lockConversation } from '../helpers/conversation-lock.js';
import { TEST_LABEL } from '../post-merge-test/plan.js';

// Locks what an agent is handed that no workflow of ours opened, so only
// collaborators can comment on it: an issue someone labels for an agent by
// hand, and a pull request an agent opens. Run by
// .github/workflows/agent-lock.yml (through main.ts). The issues the
// workflows open are locked by the script that opens them: GitHub starts no
// workflow for a label the workflow's own token applied.

/** The labels that hand an issue to an agent. */
export const AGENT_LABELS = [AGENT_LABEL, TEST_LABEL];

/** The branch prefix the agent's pull requests use. */
export const AGENT_BRANCH_PREFIX = 'openhands/';

export interface Deps {
  env: Record<string, string | undefined>;
  /** Runs the GitHub CLI with these arguments and returns its output. */
  gh: (args: string[]) => string;
  log: (message: string) => void;
}

interface Event {
  action?: string;
  label?: { name: string };
  issue?: { number: number; pull_request?: unknown };
  pull_request?: {
    number: number;
    head: { ref: string; repo: { full_name: string } | null };
  };
}

export type LockPlan =
  | { action: 'lock'; number: number; what: string }
  | { action: 'ignore'; reason: string };

export const plan = (
  eventName: string | undefined,
  event: Event,
  repository: string,
): LockPlan => {
  if (eventName === 'issues' && event.action === 'labeled' && event.issue) {
    const label = event.label?.name ?? '';
    if (!AGENT_LABELS.includes(label)) {
      return {
        action: 'ignore',
        reason: `the label ${label} is not an agent's`,
      };
    }
    return {
      action: 'lock',
      number: event.issue.number,
      what: `issue #${event.issue.number}, labelled ${label}`,
    };
  }
  if (
    eventName === 'pull_request' &&
    (event.action === 'opened' || event.action === 'reopened') &&
    event.pull_request
  ) {
    const { number, head } = event.pull_request;
    if (!head.ref.startsWith(AGENT_BRANCH_PREFIX)) {
      return { action: 'ignore', reason: `${head.ref} is not an agent branch` };
    }
    // A fork's pull request can use the agent's branch name too.
    if (head.repo?.full_name !== repository) {
      return { action: 'ignore', reason: `#${number} comes from a fork` };
    }
    return {
      action: 'lock',
      number,
      what: `the agent's pull request #${number}`,
    };
  }
  return {
    action: 'ignore',
    reason: `nothing to lock for ${eventName} ${event.action ?? ''}`.trim(),
  };
};

export const run = ({ env, gh, log }: Deps): void => {
  const repository = env.GITHUB_REPOSITORY;
  if (!repository || !env.GITHUB_EVENT_PATH) {
    throw new Error('GITHUB_REPOSITORY and GITHUB_EVENT_PATH must be set');
  }
  const event = JSON.parse(
    readFileSync(env.GITHUB_EVENT_PATH, 'utf8'),
  ) as Event;
  const decision = plan(env.GITHUB_EVENT_NAME, event, repository);
  if (decision.action === 'ignore') {
    log(`::notice::Nothing locked: ${decision.reason}`);
    return;
  }
  lockConversation(repository, decision.number, gh);
  log(`::notice::Locked ${decision.what}`);
};
