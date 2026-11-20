/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { plan, run } from './run.js';

const REPOSITORY = 'o/r';

const labelled = (name: string) => ({
  action: 'labeled',
  label: { name },
  issue: { number: 7 },
});

const opened = (ref: string, repo: string | null = REPOSITORY) => ({
  action: 'opened',
  pull_request: {
    number: 8,
    head: { ref, repo: repo === null ? null : { full_name: repo } },
  },
});

describe('plan', () => {
  it.each(['openhands', 'openhands-test'])(
    'locks an issue labelled %s',
    (label) => {
      expect(plan('issues', labelled(label), REPOSITORY)).toMatchObject({
        action: 'lock',
        number: 7,
      });
    },
  );

  it('ignores any other label', () => {
    expect(plan('issues', labelled('bug'), REPOSITORY).action).toBe('ignore');
  });

  it("locks the agent's pull request", () => {
    expect(
      plan('pull_request', opened('openhands/issue-12'), REPOSITORY),
    ).toMatchObject({ action: 'lock', number: 8 });
    expect(
      plan(
        'pull_request',
        { ...opened('openhands/issue-12'), action: 'reopened' },
        REPOSITORY,
      ).action,
    ).toBe('lock');
  });

  it('ignores a pull request from another branch', () => {
    expect(plan('pull_request', opened('fix/thing'), REPOSITORY).action).toBe(
      'ignore',
    );
  });

  it('ignores a fork using the agent branch name', () => {
    expect(
      plan('pull_request', opened('openhands/issue-12', 'evil/r'), REPOSITORY)
        .action,
    ).toBe('ignore');
    expect(
      plan('pull_request', opened('openhands/issue-12', null), REPOSITORY)
        .action,
    ).toBe('ignore');
  });

  it('ignores other pull request actions', () => {
    expect(
      plan(
        'pull_request',
        { ...opened('openhands/issue-12'), action: 'synchronize' },
        REPOSITORY,
      ).action,
    ).toBe('ignore');
  });
});

describe('run', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-lock-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const runWith = (
    eventName: string,
    event: unknown,
    alreadyLocked = false,
  ) => {
    const path = join(dir, 'event.json');
    writeFileSync(path, JSON.stringify(event));
    const calls: string[][] = [];
    const logs: string[] = [];
    run({
      env: {
        GITHUB_REPOSITORY: REPOSITORY,
        GITHUB_EVENT_PATH: path,
        GITHUB_EVENT_NAME: eventName,
      },
      log: (message) => logs.push(message),
      gh: (args) => {
        calls.push(args);
        return args.includes('.locked') ? String(alreadyLocked) : '';
      },
    });
    return { calls, logs };
  };

  it('locks the issue', () => {
    const { calls, logs } = runWith('issues', labelled('openhands'));
    expect(calls).toContainEqual([
      'api',
      '-X',
      'PUT',
      'repos/o/r/issues/7/lock',
    ]);
    expect(logs.join('\n')).toContain('Locked issue #7');
  });

  it('leaves a locked one as it is', () => {
    const { calls } = runWith('issues', labelled('openhands'), true);
    expect(calls.some((args) => args.includes('PUT'))).toBe(false);
  });

  it('calls nothing when there is nothing to lock', () => {
    const { calls } = runWith('issues', labelled('bug'));
    expect(calls).toEqual([]);
  });
});
