/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { closedIssue, specFolders } from './discover.js';
import {
  featureName,
  instructionsFrom,
  issueMarker,
  markerFolder,
  parentIssue,
  renderIssue,
} from './issue.js';
import { planIssue } from './plan-issue.js';
import { groupPhases, parsePhases } from './tasks.js';

const TEMPLATE = `---
name: Implement a spec phase
---

## Spec

- Spec folder: \`specs/<timestamp>-<name>/\`

## Instructions for the agent

- Read CLAUDE.md first.
- In the PR description write \`Refs #<parent>\`. Never close it.
- Never merge.
`;

const TASKS = `## Phase 1: Setup

- [ ] T001 Add dependencies

## Phase 2: User Story 1 - Submit work (P1)

- [ ] T002 [US1] Procedure
`;

const FOLDER = '20261114-120542-assignment-submissions';

describe('issue helpers', () => {
  it('builds and reads the marker', () => {
    expect(markerFolder(`x\n${issueMarker(FOLDER, 2)}\ny`)).toBe(FOLDER);
    expect(markerFolder('no marker')).toBeUndefined();
  });

  it('names the feature without its number or timestamp', () => {
    expect(featureName(FOLDER)).toBe('assignment-submissions');
    expect(featureName('001-user-auth')).toBe('user-auth');
  });

  it('reads the parent issue from the spec', () => {
    expect(parentIssue('**Parent issue**: #102\n')).toBe(102);
    expect(parentIssue('**Parent issue**: none\n')).toBeUndefined();
  });

  it('takes the instructions from the template and fills in the parent', () => {
    expect(instructionsFrom(TEMPLATE, 102)).toContain('`Refs #102`');
    expect(instructionsFrom(TEMPLATE, 102)).not.toContain('<parent>');
  });

  it('drops the parent bullet when there is no parent', () => {
    const text = instructionsFrom(TEMPLATE, undefined);
    expect(text).not.toContain('Refs');
    expect(text).toContain('Never merge.');
  });

  it('fails when the template has no instructions section', () => {
    expect(() => instructionsFrom('# nothing', 1)).toThrow();
  });
});

describe('renderIssue', () => {
  const [group] = groupPhases(parsePhases(TASKS));
  const issue = renderIssue({
    folder: FOLDER,
    group,
    parent: 102,
    templateMd: TEMPLATE,
  });

  it('writes a Conventional Commit title', () => {
    expect(issue.title).toBe(
      'feat(assignment-submissions): Submit work (with setup and foundations)',
    );
  });

  it('names the spec folder, parent, task range and marker', () => {
    expect(issue.body).toContain(issueMarker(FOLDER, 0));
    expect(issue.body).toContain(`specs/${FOLDER}/`);
    expect(issue.body).toContain('Parent issue: #102');
    expect(issue.body).toContain('`T001` to `T002`');
    expect(issue.body).toContain('## Instructions for the agent');
  });
});

describe('planIssue', () => {
  const input = {
    folder: FOLDER,
    tasksMd: TASKS,
    specMd: '**Parent issue**: #102',
    templateMd: TEMPLATE,
    existingIssueBodies: [] as string[],
  };

  it('creates the issue for the next group', () => {
    const plan = planIssue(input);
    expect(plan.action).toBe('create');
  });

  it('does not create a second issue for the same group', () => {
    const plan = planIssue({
      ...input,
      existingIssueBodies: [`${issueMarker(FOLDER, 0)}\nbody`],
    });
    expect(plan.action).toBe('skip');
  });

  it('is not fooled by a marker for another group or folder', () => {
    const plan = planIssue({
      ...input,
      existingIssueBodies: [issueMarker(FOLDER, 1), issueMarker('other', 0)],
    });
    expect(plan.action).toBe('create');
  });

  it('skips when every task is done', () => {
    const plan = planIssue({
      ...input,
      tasksMd: TASKS.replaceAll('- [ ]', '- [x]'),
    });
    expect(plan).toEqual({
      action: 'skip',
      reason: `${FOLDER}: no tasks left for the agent`,
    });
  });
});

describe('discover', () => {
  it('finds the issue a pull request closes', () => {
    expect(closedIssue('Does things.\n\nCloses #42')).toBe(42);
    expect(closedIssue('fixes #7')).toBe(7);
    expect(closedIssue('Refs #102')).toBeUndefined();
    expect(closedIssue(null)).toBeUndefined();
  });

  it('finds spec folders among changed files', () => {
    expect(
      specFolders([
        'specs/a/tasks.md',
        'specs/a/spec.md',
        'specs/b/plan.md',
        'packages/x.ts',
        'specs/readme.md',
      ]),
    ).toEqual(['a', 'b']);
  });
});
