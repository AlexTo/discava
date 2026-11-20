/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testMarker } from './plan.js';
import { run } from './run.js';

const REPOSITORY = 'o/r';
const HEAD = 'head000';
const PREV = 'prev000';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'post-merge-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const deployJobs = (step: string, stage = 'discava-development') =>
  JSON.stringify({
    jobs: [
      {
        name: `Deploy (${stage})`,
        steps: [{ name: 'Deploy', conclusion: step }],
      },
    ],
  });

interface Scenario {
  conclusion?: string;
  currentJobs?: string;
  /** Older successful Deploy runs, newest first, with their jobs. */
  previous?: { id: number; sha: string; jobs: string }[];
  /** The commits between the previous deploy and HEAD, oldest first. */
  commits?: string[];
  /** Commit -> the pull request that merged as it. */
  mergedAs?: Record<string, number>;
  files?: Record<number, string[]>;
  existing?: string[];
  env?: Record<string, string>;
  /** The issue or pull request number GitHub refuses to lock. */
  lockFails?: number;
  alreadyLocked?: number[];
}

const runScenario = (scenario: Scenario) => {
  const eventPath = join(dir, 'event.json');
  writeFileSync(
    eventPath,
    JSON.stringify({
      workflow_run: {
        id: 100,
        workflow_id: 7,
        head_sha: HEAD,
        html_url: 'https://github.com/o/r/actions/runs/100',
        created_at: '2026-11-20T10:00:00Z',
        conclusion: scenario.conclusion ?? 'success',
      },
    }),
  );
  const created: { title: string; body: string; label?: string }[] = [];
  const locked: string[] = [];
  const labelled: { issue: string; label: string }[] = [];
  // Locks and labels in the order they happened.
  const order: string[] = [];
  const logs: string[] = [];
  const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];
  run({
    env: {
      GITHUB_REPOSITORY: REPOSITORY,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_EVENT_NAME: 'workflow_run',
      ...scenario.env,
    },
    log: (message) => logs.push(message),
    gh: (args) => {
      const path = args[1] ?? '';
      if (args[0] === 'label') {
        return '';
      }
      if (args[0] === 'api' && args[2] === 'PUT') {
        if (scenario.lockFails && args[3].includes(`/${scenario.lockFails}/`)) {
          throw new Error('HTTP 403');
        }
        locked.push(args[3]);
        order.push(`lock ${args[3]}`);
        return '';
      }
      const lockedState = /^repos\/o\/r\/issues\/(\d+)$/.exec(path);
      if (lockedState) {
        const n = Number(lockedState[1]);
        return (scenario.alreadyLocked ?? []).includes(n) ||
          locked.includes(`repos/o/r/issues/${n}/lock`)
          ? 'true\n'
          : 'false\n';
      }
      if (args[0] === 'issue' && args[1] === 'edit') {
        labelled.push({ issue: args[2], label: flag(args, '--add-label') });
        order.push(`label ${args[2]}`);
        return '';
      }
      if (args[0] === 'issue' && args[1] === 'create') {
        created.push({
          title: flag(args, '--title'),
          body: readFileSync(flag(args, '--body-file'), 'utf8'),
          label: args.includes('--label') ? flag(args, '--label') : undefined,
        });
        return `https://github.com/o/r/issues/${900 + created.length}\n`;
      }
      if (args[0] === 'pr' && args[1] === 'view') {
        const number = Number(args[2]);
        return JSON.stringify({
          number,
          title: `fix(core-api): change ${number}`,
          url: `https://github.com/o/r/pull/${number}`,
          labels: [],
          files: (
            scenario.files?.[number] ?? ['packages/apis/core-api/src/a.ts']
          ).map((p) => ({ path: p })),
          mergeCommit: { oid: `merge${number}` },
          body: 'Closes #5',
        });
      }
      if (path === 'repos/o/r/actions/runs/100/jobs') {
        return scenario.currentJobs ?? deployJobs('success');
      }
      if (path.startsWith('repos/o/r/actions/workflows/7/runs')) {
        return JSON.stringify({
          workflow_runs: [
            { id: 100, head_sha: HEAD, created_at: '2026-11-20T10:00:00Z' },
            ...(scenario.previous ?? []).map((r) => ({
              id: r.id,
              head_sha: r.sha,
              created_at: '2026-11-19T10:00:00Z',
            })),
          ],
        });
      }
      const jobs = /^repos\/o\/r\/actions\/runs\/(\d+)\/jobs$/.exec(path);
      if (jobs) {
        return (
          scenario.previous?.find((r) => r.id === Number(jobs[1]))?.jobs ?? ''
        );
      }
      if (path.startsWith('repos/o/r/compare/')) {
        return JSON.stringify({
          status: 'ahead',
          commits: (scenario.commits ?? []).map((sha) => ({ sha })),
        });
      }
      const pulls = /^repos\/o\/r\/commits\/([\w-]+)\/pulls$/.exec(path);
      if (pulls) {
        if (pulls[1] === 'branch-commit') {
          // A commit on #11's own branch: #11 merged as another commit.
          return JSON.stringify([
            {
              number: 11,
              merged_at: '2026-11-19T12:00:00Z',
              merge_commit_sha: 'c1',
            },
          ]);
        }
        const number = scenario.mergedAs?.[pulls[1]];
        return JSON.stringify(
          number === undefined
            ? []
            : [
                {
                  number,
                  merged_at: '2026-11-19T12:00:00Z',
                  merge_commit_sha: pulls[1],
                },
              ],
        );
      }
      if (path.startsWith('repos/o/r/issues?')) {
        return (scenario.existing ?? [])
          .map((body) => JSON.stringify(body))
          .join('\n');
      }
      throw new Error(`Unexpected gh ${args.join(' ')}`);
    },
  });
  return { created, logs, locked, labelled, order };
};

describe('run', () => {
  it('opens an issue for each pull request merged since the previous deploy', () => {
    const { created } = runScenario({
      previous: [
        { id: 99, sha: 'stale', jobs: deployJobs('skipped') },
        { id: 98, sha: PREV, jobs: deployJobs('success') },
      ],
      commits: ['c1', 'branch-commit', HEAD],
      mergedAs: { c1: 11, [HEAD]: 12 },
    });
    expect(created.map((issue) => issue.title)).toEqual([
      'test(post-merge): verify #11 change 11',
      'test(post-merge): verify #12 change 12',
    ]);
    // Opened unlabelled: the label goes on once everything is locked.
    expect(created[0].label).toBeUndefined();
    expect(created[0].body).toContain(testMarker(11));
    expect(created[0].body).toContain(`at \`${HEAD}\``);
    expect(created[0].body).toContain('Issue it closes: #5');
  });

  it('locks the issue, the pull request and what it closes, then labels it', () => {
    const { labelled, order } = runScenario({
      previous: [{ id: 98, sha: PREV, jobs: deployJobs('success') }],
      commits: ['c1', HEAD],
      mergedAs: { c1: 11, [HEAD]: 12 },
    });
    expect(order).toEqual([
      'lock repos/o/r/issues/901/lock',
      'lock repos/o/r/issues/11/lock',
      'lock repos/o/r/issues/5/lock',
      'label 901',
      'lock repos/o/r/issues/902/lock',
      'lock repos/o/r/issues/12/lock',
      // #5 is locked already.
      'label 902',
    ]);
    expect(labelled).toEqual([
      { issue: '901', label: 'openhands-test' },
      { issue: '902', label: 'openhands-test' },
    ]);
  });

  it('leaves an already locked pull request as it is', () => {
    const { locked } = runScenario({
      existing: [testMarker(12)],
      alreadyLocked: [12, 5],
      env: { GITHUB_EVENT_NAME: 'workflow_dispatch', PR_NUMBER: '12' },
    });
    expect(locked).toEqual(['repos/o/r/issues/901/lock']);
  });

  it.each([
    ['the issue it closes', 5],
    ['the pull request', 12],
    ['the issue', 901],
  ])('never labels the issue when %s could not be locked', (_, refused) => {
    const { labelled, logs } = runScenario({
      mergedAs: { [HEAD]: 12 },
      lockFails: refused,
    });
    expect(labelled).toEqual([]);
    expect(logs.join('\n')).toContain('::warning::Could not lock');
  });

  it('tests only the head commit when no previous deploy is found', () => {
    const { created } = runScenario({ mergedAs: { [HEAD]: 12 } });
    expect(created.map((issue) => issue.title)).toEqual([
      'test(post-merge): verify #12 change 12',
    ]);
  });

  it('skips pull requests already tested or with nothing deployed', () => {
    const { created, logs } = runScenario({
      previous: [{ id: 98, sha: PREV, jobs: deployJobs('success') }],
      commits: ['c1', 'c2', HEAD],
      mergedAs: { c1: 11, c2: 13, [HEAD]: 12 },
      files: { 13: ['docs/a.md'] },
      existing: [`${testMarker(11)}\n...`],
    });
    expect(created.map((issue) => issue.title)).toEqual([
      'test(post-merge): verify #12 change 12',
    ]);
    expect(logs.join('\n')).toContain('#11 already has a test issue');
    expect(logs.join('\n')).toContain('#13 changes nothing that is deployed');
  });

  it('does nothing when the run deployed nothing', () => {
    const { created, logs } = runScenario({
      currentJobs: deployJobs('skipped'),
    });
    expect(created).toEqual([]);
    expect(logs.join('\n')).toContain('deployed nothing');
  });

  it('does nothing for another stage', () => {
    const { created, logs } = runScenario({
      currentJobs: deployJobs('success', 'discava-production'),
    });
    expect(created).toEqual([]);
    expect(logs.join('\n')).toContain('deployed discava-production');
  });

  it('does nothing when the Deploy run failed', () => {
    expect(runScenario({ conclusion: 'failure' }).created).toEqual([]);
  });

  it('prints instead of creating on a dry run', () => {
    const { created, logs } = runScenario({
      mergedAs: { [HEAD]: 12 },
      env: { DRY_RUN: 'true' },
    });
    expect(created).toEqual([]);
    expect(logs.join('\n')).toContain(testMarker(12));
  });

  it('opens an issue by hand for one pull request, even one already tested', () => {
    const { created } = runScenario({
      existing: [testMarker(12)],
      files: { 12: ['docs/a.md'] },
      env: { GITHUB_EVENT_NAME: 'workflow_dispatch', PR_NUMBER: '#12' },
    });
    expect(created.map((issue) => issue.title)).toEqual([
      'test(post-merge): verify #12 change 12',
    ]);
    expect(created[0].body).toContain('at `merge12`');
  });

  it('refuses a malformed pull request number by hand', () => {
    expect(() =>
      runScenario({
        env: { GITHUB_EVENT_NAME: 'workflow_dispatch', PR_NUMBER: 'abc' },
      }),
    ).toThrow('PR_NUMBER');
  });
});
