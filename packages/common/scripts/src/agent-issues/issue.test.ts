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
  isSpecFolderName,
  issueMarker,
  issueTitle,
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

  it('refuses a marker whose folder could leave specs/', () => {
    for (const folder of ['../../etc', '..', '.hidden', 'a/b', '']) {
      expect(
        markerFolder(`<!-- agent-issue spec:${folder} group:0 -->`),
      ).toBeUndefined();
      expect(isSpecFolderName(folder)).toBe(false);
    }
    expect(isSpecFolderName('001-user.auth_v2')).toBe(true);
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

  it('writes a Conventional Commit title with a lower-case subject', () => {
    expect(issue.title).toBe(
      'feat(assignment-submissions): submit work (with setup and foundations)',
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

describe('issueTitle', () => {
  const group = (title: string, withFoundations = false) => ({
    index: 0,
    title,
    withFoundations,
    phases: [],
    tasks: [],
  });

  it('leaves an acronym alone and drops a trailing full stop', () => {
    expect(issueTitle('001-x', group('API keys for students.'))).toBe(
      'feat(x): API keys for students',
    );
  });

  it('drops the suffix, then whole words, to stay within 100 characters', () => {
    // 58 characters: fits in the 70 left after the prefix, but not with the
    // 29-character suffix.
    const long = 'Submit work to an upload assignment from the lesson player';
    expect(issueTitle(FOLDER, group(long, true))).toBe(
      'feat(assignment-submissions): submit work to an upload assignment from the lesson player',
    );
    const cut = issueTitle(
      FOLDER,
      group(`${long} and several more words of detail`),
    );
    expect(cut).toBe(
      'feat(assignment-submissions): submit work to an upload assignment from the lesson player and several',
    );
    expect(cut.length).toBe(100);
    // Cut mid-word: back to the last whole word.
    expect(issueTitle(FOLDER, group(`${long} and severally more words`))).toBe(
      'feat(assignment-submissions): submit work to an upload assignment from the lesson player and',
    );
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

  it('does not create a second issue for the same group, and says what is left', () => {
    const plan = planIssue({
      ...input,
      existingIssueBodies: [`${issueMarker(FOLDER, 0)}\nbody`],
    });
    expect(plan).toMatchObject({
      action: 'stalled',
      title: 'Submit work',
      unticked: ['T001', 'T002'],
    });
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
      action: 'done',
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
        'specs/.hidden/tasks.md',
      ]),
    ).toEqual(['a', 'b']);
  });
});
