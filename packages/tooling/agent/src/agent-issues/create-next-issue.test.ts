/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from './create-next-issue.js';
import { issueMarker } from './issue.js';

const FOLDER = '20261114-120542-assignment-submissions';
const REPOSITORY = 'AlexTo/discava';

const TEMPLATE = `## Instructions for the agent

- Read CLAUDE.md first.
- In the PR description write \`Refs #<parent>\`.
`;

const tasks = (firstGroupDone: boolean) => `## Phase 1: Setup

- [${firstGroupDone ? 'x' : ' '}] T001 Add dependencies

## Phase 2: User Story 1 - Submit work (P1)

- [${firstGroupDone ? 'x' : ' '}] T002 [US1] Procedure

## Phase 3: User Story 2 - Resubmit (P2)

- [ ] T003 [US2] Resubmit
`;

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agent-issues-test-'));
  mkdirSync(join(root, 'specs', FOLDER), { recursive: true });
  mkdirSync(join(root, '.github/ISSUE_TEMPLATE'), { recursive: true });
  writeFileSync(
    join(root, 'specs', FOLDER, 'spec.md'),
    '**Parent issue**: #102\n',
  );
  writeFileSync(
    join(root, '.github/ISSUE_TEMPLATE/implement-phase.md'),
    TEMPLATE,
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

interface Scenario {
  tasksMd?: string;
  pr?: {
    merged?: boolean;
    labels?: string[];
    headRef?: string;
    body?: string | null;
  };
  /** workflow_dispatch with this SPEC_FOLDER instead of a pull request. */
  dispatch?: string;
  /** Files the pull request changed. */
  files?: string[];
  /** Bodies of the repository's issues (the stub applies no filter). */
  issueBodies?: string[];
  /** Body of the issue `gh issue view` returns. */
  linkedIssueBody?: string;
  /** `gh issue view` fails, as it does for a number that is no issue. */
  linkedIssueMissing?: boolean;
  dryRun?: boolean;
}

// Runs the script against a stub `gh` that answers from the scenario and
// records what it was asked to do.
const runScenario = (scenario: Scenario) => {
  writeFileSync(
    join(root, 'specs', FOLDER, 'tasks.md'),
    scenario.tasksMd ?? tasks(false),
  );
  const eventPath = join(root, 'event.json');
  writeFileSync(
    eventPath,
    JSON.stringify({
      pull_request: {
        number: 302,
        body: scenario.pr?.body ?? null,
        merged: scenario.pr?.merged ?? true,
        labels: (scenario.pr?.labels ?? []).map((name) => ({ name })),
        head: { ref: scenario.pr?.headRef ?? 'some-branch' },
      },
    }),
  );
  const calls: string[][] = [];
  const created: { title: string; body: string; label: string }[] = [];
  const comments: { pr: string; body: string }[] = [];
  const logs: string[] = [];
  const arg = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
  run({
    env: {
      GITHUB_REPOSITORY: REPOSITORY,
      GITHUB_WORKSPACE: root,
      GITHUB_EVENT_PATH: eventPath,
      ...(scenario.dispatch !== undefined && {
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        SPEC_FOLDER: scenario.dispatch,
      }),
      ...(scenario.dryRun && { DRY_RUN: 'true' }),
    },
    log: (message) => logs.push(message),
    gh: (args) => {
      calls.push(args);
      const [command, subcommand] = args;
      if (command === 'api' && args[1].includes('/pulls/')) {
        return (scenario.files ?? []).join('\n');
      }
      if (command === 'api' && args[1].includes('/issues?')) {
        return (scenario.issueBodies ?? [])
          .map((body) => JSON.stringify(body))
          .join('\n');
      }
      if (command === 'issue' && subcommand === 'view') {
        if (scenario.linkedIssueMissing) {
          throw new Error('GraphQL: Could not resolve to an Issue');
        }
        return JSON.stringify({ body: scenario.linkedIssueBody ?? null });
      }
      if (command === 'issue' && subcommand === 'create') {
        created.push({
          title: arg(args, '--title'),
          body: readFileSync(arg(args, '--body-file'), 'utf8'),
          label: arg(args, '--label'),
        });
        return 'https://github.com/AlexTo/discava/issues/400\n';
      }
      if (command === 'pr' && subcommand === 'comment') {
        comments.push({
          pr: args[2],
          body: readFileSync(arg(args, '--body-file'), 'utf8'),
        });
        return '';
      }
      throw new Error(`Unexpected gh call: ${args.join(' ')}`);
    },
  });
  return { calls, created, comments, logs };
};

const specFiles = [`specs/${FOLDER}/tasks.md`, `specs/${FOLDER}/spec.md`];

describe('a merged pull request', () => {
  it('labelled spec-ready opens the first issue, labelled for the agent', () => {
    const { created, logs } = runScenario({
      pr: { labels: ['spec-ready'] },
      files: specFiles,
    });
    expect(created).toHaveLength(1);
    expect(created[0].title).toBe(
      'feat(assignment-submissions): submit work (with setup and foundations)',
    );
    expect(created[0].label).toBe('openhands');
    expect(created[0].body).toContain(issueMarker(FOLDER, 0));
    expect(created[0].body).toContain('`T001` to `T002`');
    expect(created[0].body).toContain('`Refs #102`');
    expect(logs.join('\n')).toContain('Created https://github.com/');
  });

  it('without the label does nothing, even when it changes a spec', () => {
    const { calls, created } = runScenario({ files: specFiles });
    expect(calls).toEqual([]);
    expect(created).toEqual([]);
  });

  it('that was closed without merging does nothing', () => {
    const { calls } = runScenario({
      pr: { merged: false, labels: ['spec-ready'] },
      files: specFiles,
    });
    expect(calls).toEqual([]);
  });

  it('that changes no spec folder opens nothing', () => {
    const { created, logs } = runScenario({
      pr: { labels: ['spec-ready'] },
      files: ['README.md'],
    });
    expect(created).toEqual([]);
    expect(logs.join('\n')).toContain('no spec folder');
  });
});

describe("an agent's merged pull request", () => {
  const agentPr = { headRef: 'openhands/issue-42', body: 'Closes #42' };

  it('opens the next issue for the spec its issue named', () => {
    const { created } = runScenario({
      tasksMd: tasks(true),
      pr: agentPr,
      linkedIssueBody: issueMarker(FOLDER, 0),
      issueBodies: [issueMarker(FOLDER, 0)],
    });
    expect(created).toHaveLength(1);
    expect(created[0].title).toBe('feat(assignment-submissions): resubmit');
    expect(created[0].body).toContain(issueMarker(FOLDER, 1));
  });

  it('falls back to the files it changed when its issue has no marker', () => {
    const { created } = runScenario({
      tasksMd: tasks(true),
      pr: agentPr,
      linkedIssueBody: 'An ordinary issue',
      files: specFiles,
    });
    expect(created).toHaveLength(1);
  });

  it('falls back to the files it changed when its issue cannot be read', () => {
    const { created } = runScenario({
      tasksMd: tasks(true),
      pr: agentPr,
      linkedIssueMissing: true,
      files: specFiles,
    });
    expect(created).toHaveLength(1);
  });

  it('does not follow a marker that points outside specs/', () => {
    const { created, logs } = runScenario({
      pr: agentPr,
      linkedIssueBody: '<!-- agent-issue spec:../../etc group:0 -->',
      files: ['packages/x.ts'],
    });
    expect(created).toEqual([]);
    expect(logs.join('\n')).toContain('no spec folder');
  });

  it('that left tasks unticked opens nothing and says so on the pull request', () => {
    const { created, comments } = runScenario({
      pr: agentPr,
      linkedIssueBody: issueMarker(FOLDER, 0),
      // The first issue exists, without the agent's label for all we know.
      issueBodies: [`${issueMarker(FOLDER, 0)}\nbody`],
    });
    expect(created).toEqual([]);
    expect(comments).toHaveLength(1);
    expect(comments[0].pr).toBe('302');
    expect(comments[0].body).toContain('T001, T002');
    expect(comments[0].body).toContain(`specs/${FOLDER}/`);
  });

  it('opens nothing once every task is ticked', () => {
    const { created, comments } = runScenario({
      tasksMd: tasks(true).replace('- [ ] T003', '- [x] T003'),
      pr: agentPr,
      linkedIssueBody: issueMarker(FOLDER, 1),
    });
    expect(created).toEqual([]);
    expect(comments).toEqual([]);
  });
});

describe('a tasks.md that is not in the expected format', () => {
  it('fails the run, names the problem and opens nothing', () => {
    const logs: string[] = [];
    const calls: string[][] = [];
    writeFileSync(
      join(root, 'specs', FOLDER, 'tasks.md'),
      '### Phase 1: Setup\n\n- [ ] T001 Add dependencies\n',
    );
    expect(() =>
      run({
        env: {
          GITHUB_REPOSITORY: REPOSITORY,
          GITHUB_WORKSPACE: root,
          GITHUB_EVENT_NAME: 'workflow_dispatch',
          SPEC_FOLDER: FOLDER,
        },
        log: (message) => logs.push(message),
        gh: (args) => {
          calls.push(args);
          return '';
        },
      }),
    ).toThrow(/not in the format/);
    expect(logs.join('\n')).toContain(
      `::error file=specs/${FOLDER}/tasks.md,line=1::A phase heading must be written`,
    );
    expect(calls.some(([command]) => command === 'issue')).toBe(false);
  });
});

describe('run by hand', () => {
  it('opens the next issue for the named folder, whatever the event', () => {
    const { created, calls } = runScenario({ dispatch: `specs/${FOLDER}/` });
    expect(created).toHaveLength(1);
    expect(calls.some(([, path]) => path?.includes('/pulls/'))).toBe(false);
  });

  it('refuses a folder name that could leave specs/', () => {
    expect(() => runScenario({ dispatch: '../../etc' })).toThrow(/SPEC_FOLDER/);
    expect(() => runScenario({ dispatch: '' })).toThrow(/SPEC_FOLDER/);
  });

  it('only notes a stalled chain: there is no pull request to comment on', () => {
    const { created, comments, logs } = runScenario({
      dispatch: FOLDER,
      issueBodies: [issueMarker(FOLDER, 0)],
    });
    expect(created).toEqual([]);
    expect(comments).toEqual([]);
    expect(logs.join('\n')).toContain('not all ticked');
  });
});

describe('a dry run', () => {
  it('prints the issue and changes nothing', () => {
    const { created, comments, logs } = runScenario({
      pr: { labels: ['spec-ready'] },
      files: specFiles,
      dryRun: true,
    });
    expect(created).toEqual([]);
    expect(comments).toEqual([]);
    expect(logs.join('\n')).toContain(
      'feat(assignment-submissions): submit work',
    );
  });
});
