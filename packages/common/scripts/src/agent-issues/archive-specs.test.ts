/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from './archive-specs.js';
import { issueMarker } from './issue.js';

const DONE = '20261115-204447-certificates';
const LIVE = '20261116-013307-course-reviews';

const TASKS_DONE = `## Phase 1: User Story 1 - Issue

- [x] T001 Build it
- [x] T002 **(human)** Check by hand
`;

let root: string;
let remote: string;

const git = (args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' });

const write = (file: string, text: string) => {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
};
const read = (file: string) => readFileSync(join(root, file), 'utf8');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'archive-specs-test-'));
  remote = mkdtempSync(join(tmpdir(), 'archive-specs-remote-'));
  execFileSync('git', ['init', '--bare', '--quiet', remote]);
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['remote', 'add', 'origin', remote]);

  write(`specs/${DONE}/tasks.md`, TASKS_DONE);
  write(
    `specs/${DONE}/spec.md`,
    '**Design page**: [`design/certificates`](../../docs/design/certificates.mdx)\n',
  );
  write(
    `specs/${LIVE}/tasks.md`,
    TASKS_DONE.replace('- [x] T002', '- [ ] T002'),
  );
  write(
    `specs/${LIVE}/plan.md`,
    `Depends on [certificates](../${DONE}/plan.md).\n`,
  );
  write(
    'docs/design/certificates.mdx',
    `**Spec:** [\`specs/${DONE}/\`](https://github.com/o/r/tree/main/specs/${DONE}/)\n`,
  );
  write('src/certificate.ts', `// See specs/${DONE}/data-model.md\n`);
  git(['add', '--all']);
  git(['commit', '--quiet', '--message', 'init']);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
});

interface Scenario {
  openIssueBodies?: string[];
  earlierPrs?: string[];
  dryRun?: boolean;
}

const runScenario = (scenario: Scenario = {}) => {
  const created: { title: string; head: string; body: string }[] = [];
  const logs: string[] = [];
  const arg = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
  run({
    env: {
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_WORKSPACE: root,
      ...(scenario.dryRun && { DRY_RUN: 'true' }),
    },
    git,
    log: (message) => logs.push(message),
    gh: (args) => {
      const [command, subcommand] = args;
      if (command === 'api' && args[1].includes('/issues?state=open')) {
        return (scenario.openIssueBodies ?? [])
          .map((body) => JSON.stringify(body))
          .join('\n');
      }
      if (command === 'pr' && subcommand === 'list') {
        return (scenario.earlierPrs ?? []).join('\n');
      }
      if (command === 'pr' && subcommand === 'create') {
        created.push({
          title: arg(args, '--title'),
          head: arg(args, '--head'),
          body: readFileSync(arg(args, '--body-file'), 'utf8'),
        });
        return 'https://github.com/o/r/pull/600\n';
      }
      throw new Error(`Unexpected gh call: ${args.join(' ')}`);
    },
  });
  return { created, logs };
};

describe('archive-specs', () => {
  it('opens a pull request that moves a finished spec and fixes its links', () => {
    const { created, logs } = runScenario();

    expect(created).toEqual([
      expect.objectContaining({
        title: 'chore(specs): archive certificates',
        head: `archive-spec/${DONE}`,
      }),
    ]);
    expect(logs.join('\n')).toContain('Opened https://github.com/o/r/pull/600');

    // The branch was pushed with the move; the checkout is back where it was.
    git(['switch', '--quiet', `archive-spec/${DONE}`]);
    expect(existsSync(join(root, 'specs', DONE))).toBe(false);
    expect(read(`specs/_archive/${DONE}/spec.md`)).toContain(
      '](../../../docs/design/certificates.mdx)',
    );
    expect(read('docs/design/certificates.mdx')).toContain(
      `tree/main/specs/_archive/${DONE}/`,
    );
    expect(read('src/certificate.ts')).toContain(`specs/_archive/${DONE}/`);
    expect(read(`specs/${LIVE}/plan.md`)).toContain(
      `](../_archive/${DONE}/plan.md)`,
    );
    expect(
      execFileSync('git', ['branch', '--list', `archive-spec/${DONE}`], {
        cwd: remote,
        encoding: 'utf8',
      }),
    ).toContain(`archive-spec/${DONE}`);
  });

  it('leaves a spec with an unticked (human) task live', () => {
    const { created } = runScenario();
    expect(created.map(({ head }) => head)).not.toContain(
      `archive-spec/${LIVE}`,
    );
  });

  it('skips a spec that still has an open agent issue', () => {
    const { created, logs } = runScenario({
      openIssueBodies: [issueMarker(DONE, 1)],
    });
    expect(created).toEqual([]);
    expect(logs.join('\n')).toContain('still has an open agent issue');
  });

  it('skips a spec that already had an archive pull request', () => {
    const { created, logs } = runScenario({
      earlierPrs: ['https://github.com/o/r/pull/599'],
    });
    expect(created).toEqual([]);
    expect(logs.join('\n')).toContain('already has');
  });

  it('only lists what it would archive on a dry run', () => {
    const { created, logs } = runScenario({ dryRun: true });
    expect(created).toEqual([]);
    expect(logs).toContain(`Would archive ${DONE}`);
    expect(git(['status', '--porcelain'])).toBe('');
  });
});
