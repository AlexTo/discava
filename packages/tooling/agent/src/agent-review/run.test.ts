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
const BODY = [
  '<!-- openhands-review-run: 0756e0b0 -->',
  '**Blocking** 1. thing',
  '',
  '🔄 CHANGES REQUESTED',
].join('\n');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-review-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Scenario {
  action?: string;
  review?: Record<string, unknown>;
  headRef?: string;
  pr?: { state?: string; sha?: string; labels?: string[] };
  statuses?: { context: string; state: string }[];
  dryRun?: boolean;
  agentApp?: string;
}

const runScenario = (scenario: Scenario) => {
  const eventPath = join(dir, 'event.json');
  writeFileSync(
    eventPath,
    JSON.stringify({
      action: scenario.action ?? 'submitted',
      review: {
        body: BODY,
        commit_id: SHA,
        user: { login: 'AlexTo' },
        author_association: 'OWNER',
        html_url: 'https://github.com/AlexTo/discava/pull/362#review-1',
        ...scenario.review,
      },
      pull_request: {
        number: 362,
        head: { ref: scenario.headRef ?? 'openhands/issue-361' },
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
      ...(scenario.agentApp && { AGENT_APP_LOGIN: scenario.agentApp }),
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
        written.push({ path, fields: field(args, '-f').join(' | ') });
        return '';
      }
      if (path.endsWith('/pulls/362')) {
        return JSON.stringify({
          state: scenario.pr?.state ?? 'open',
          head: { sha: scenario.pr?.sha ?? SHA },
          labels: (scenario.pr?.labels ?? []).map((name) => ({ name })),
        });
      }
      if (path.endsWith('/statuses')) {
        return JSON.stringify(scenario.statuses ?? []);
      }
      throw new Error(`Unexpected gh call: ${args.join(' ')}`);
    },
  });
  return { calls, logs, written, comments };
};

describe('a review asking for changes on an agent pull request', () => {
  it('adds the attempt label, then the failure status on the reviewed commit', () => {
    const { written, logs } = runScenario({});
    expect(written).toEqual([
      {
        path: `repos/${REPOSITORY}/issues/362/labels`,
        fields: 'labels[]=review-fix-1',
      },
      {
        path: `repos/${REPOSITORY}/statuses/${SHA}`,
        fields: [
          'state=failure',
          'context=software-factory/review',
          'description=Review requested changes (fix attempt 1 of 5): see the review',
          'target_url=https://github.com/AlexTo/discava/pull/362#review-1',
        ].join(' | '),
      },
    ]);
    expect(logs.join('\n')).toContain('fix attempt 1');
  });

  it('counts review-fix labels apart from ci-fix ones', () => {
    const { written } = runScenario({
      pr: { labels: ['ci-fix-1', 'ci-fix-2', 'ci-fix-3', 'review-fix-1'] },
    });
    expect(written[0].fields).toBe('labels[]=review-fix-2');
  });

  it('gives up with a label and one comment after the attempt limit', () => {
    const { written, comments } = runScenario({
      pr: {
        labels: [
          'review-fix-1',
          'review-fix-2',
          'review-fix-3',
          'review-fix-4',
          'review-fix-5',
        ],
      },
    });
    expect(
      written.map(({ path }) => path.split('/').slice(-2).join('/')),
    ).toEqual(['362/labels', '362/comments']);
    expect(written[0].fields).toBe('labels[]=review-fix-exhausted');
    expect(comments[0]).toContain('after 5 automatic fix attempts');
  });

  it('writes nothing for a review of a commit that is no longer the head', () => {
    expect(runScenario({ pr: { sha: 'f'.repeat(40) } }).written).toEqual([]);
  });

  it('writes nothing when the commit was already sent back', () => {
    expect(
      runScenario({
        statuses: [{ context: 'software-factory/review', state: 'failure' }],
      }).written,
    ).toEqual([]);
  });

  it("writes nothing for an approval, a person's review or an outsider", () => {
    const approved = BODY.replace('🔄 CHANGES REQUESTED', '✅ APPROVED');
    expect(runScenario({ review: { body: approved } }).written).toEqual([]);
    expect(
      runScenario({ review: { body: '🔄 CHANGES REQUESTED' } }).written,
    ).toEqual([]);
    expect(
      runScenario({ review: { author_association: 'NONE' } }).written,
    ).toEqual([]);
  });

  it('writes the status for a review from the AGENT_APP_LOGIN app, and only that', () => {
    const review = {
      user: { login: 'agent[bot]' },
      author_association: 'NONE',
    };
    expect(runScenario({ review, agentApp: 'agent[bot]' }).written).not.toEqual(
      [],
    );
    expect(runScenario({ review }).written).toEqual([]);
  });

  it('writes nothing for an edited review', () => {
    expect(runScenario({ action: 'edited' }).written).toEqual([]);
  });

  it('writes nothing for a branch that is not an agent branch, and looks nothing up', () => {
    const { calls, written } = runScenario({ headRef: 'feature/x' });
    expect(calls).toEqual([]);
    expect(written).toEqual([]);
  });

  it('writes nothing on a dry run', () => {
    const { written, logs } = runScenario({ dryRun: true });
    expect(written).toEqual([]);
    expect(logs.join('\n')).toContain('"action": "send-back"');
  });
});
