/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from './run.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const REPOSITORY = 'AlexTo/discava';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-ci-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Scenario {
  workflowRun?: Record<string, unknown>;
  pr?: { state?: string; sha?: string; labels?: string[] };
  statuses?: { context: string; state: string }[];
  failedJobs?: string[];
  foundByBranch?: string;
  dryRun?: boolean;
}

const runScenario = (scenario: Scenario) => {
  const eventPath = join(dir, 'event.json');
  writeFileSync(
    eventPath,
    JSON.stringify({
      workflow_run: {
        id: 99,
        event: 'pull_request',
        conclusion: 'failure',
        head_branch: 'openhands/issue-308',
        head_sha: SHA,
        html_url: 'https://github.com/AlexTo/discava/actions/runs/99',
        pull_requests: [{ number: 312 }],
        ...scenario.workflowRun,
      },
    }),
  );
  const calls: string[][] = [];
  const logs: string[] = [];
  const written: Record<string, string>[] = [];
  const comments: string[] = [];
  const field = (args: string[], flag: string) =>
    args
      .map((arg, index) => (args[index - 1] === flag ? arg : undefined))
      .filter((value): value is string => value !== undefined);
  run({
    env: {
      GITHUB_REPOSITORY: REPOSITORY,
      GITHUB_EVENT_PATH: eventPath,
      ...(scenario.dryRun && { DRY_RUN: 'true' }),
    },
    log: (message) => logs.push(message),
    gh: (args) => {
      calls.push(args);
      // `api <path>` for a read, `api -X POST <path>` for a write.
      const path = args.find((arg) => arg.startsWith('repos/')) ?? '';
      if (args.includes('POST')) {
        if (path.endsWith('/comments')) {
          comments.push(
            readFileSync(field(args, '-F')[0].replace(/^body=@/, ''), 'utf8'),
          );
        }
        written.push({
          path,
          fields: field(args, '-f').join(' | '),
        });
        return '';
      }
      if (path.includes('/pulls?')) {
        return scenario.foundByBranch ?? '';
      }
      if (path.endsWith('/pulls/312')) {
        return JSON.stringify({
          state: scenario.pr?.state ?? 'open',
          head: { sha: scenario.pr?.sha ?? SHA },
          labels: (scenario.pr?.labels ?? []).map((name) => ({ name })),
        });
      }
      if (path.endsWith('/statuses')) {
        return JSON.stringify(scenario.statuses ?? []);
      }
      if (path.includes('/jobs')) {
        return (scenario.failedJobs ?? ['Checks (test)']).join('\n');
      }
      throw new Error(`Unexpected gh call: ${args.join(' ')}`);
    },
  });
  return { calls, logs, written, comments };
};

describe('a failed run on an agent pull request', () => {
  it('adds the attempt label, then the failure status on the run commit', () => {
    const { written, logs } = runScenario({
      failedJobs: ['Checks (test)', 'E2E tests'],
    });
    expect(written).toEqual([
      {
        path: `repos/${REPOSITORY}/issues/312/labels`,
        fields: 'labels[]=ci-fix-1',
      },
      {
        path: `repos/${REPOSITORY}/statuses/${SHA}`,
        fields: [
          'state=failure',
          'context=software-factory/review',
          'description=CI failed (fix attempt 1 of 3): Checks (test), E2E tests',
          'target_url=https://github.com/AlexTo/discava/actions/runs/99',
        ].join(' | '),
      },
    ]);
    expect(logs.join('\n')).toContain('fix attempt 1');
  });

  it('finds the pull request by branch when the run does not list it', () => {
    const { written } = runScenario({
      workflowRun: { pull_requests: [] },
      foundByBranch: '312\n',
    });
    expect(written).toHaveLength(2);
  });

  it('opens nothing when there is no pull request', () => {
    const { written, logs } = runScenario({
      workflowRun: { pull_requests: [] },
    });
    expect(written).toEqual([]);
    expect(logs.join('\n')).toContain('no open pull request');
  });

  it('gives up with a label and one comment after the attempt limit', () => {
    const { written, comments } = runScenario({
      pr: { labels: ['ci-fix-1', 'ci-fix-2', 'ci-fix-3'] },
    });
    expect(
      written.map(({ path }) => path.split('/').slice(-2).join('/')),
    ).toEqual(['312/labels', '312/comments']);
    expect(written[0].fields).toBe('labels[]=ci-fix-exhausted');
    expect(comments[0]).toContain('after 3 automatic fix attempts');
  });

  it('writes nothing for a run on a commit that is no longer the head', () => {
    expect(runScenario({ pr: { sha: 'f'.repeat(40) } }).written).toEqual([]);
  });

  it('writes nothing when the commit was already sent back', () => {
    expect(
      runScenario({
        statuses: [{ context: 'software-factory/review', state: 'failure' }],
      }).written,
    ).toEqual([]);
  });

  it('writes nothing for a branch that is not an agent branch, and looks nothing up', () => {
    const { calls, written } = runScenario({
      workflowRun: { head_branch: 'feature/x' },
    });
    expect(calls).toEqual([]);
    expect(written).toEqual([]);
  });

  it('writes nothing on a dry run', () => {
    const { written, logs } = runScenario({ dryRun: true });
    expect(written).toEqual([]);
    expect(logs.join('\n')).toContain('"action": "send-back"');
  });
});

describe('a run that passed', () => {
  it('writes nothing and does not ask for the jobs', () => {
    const { written, calls } = runScenario({
      workflowRun: { conclusion: 'success' },
    });
    expect(written).toEqual([]);
    expect(
      calls.some((args) => args.some((arg) => arg.includes('/jobs'))),
    ).toBe(false);
  });
});
