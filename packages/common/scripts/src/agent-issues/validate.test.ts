/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatProblem, validateTasks } from './validate.js';

const VALID = `# Tasks: Something

## Format: \`[ID] [P?] [Story] Description\`

- **[P]**: Can run in parallel

## Phase 1: Setup

- [x] T001 Add dependencies

## Phase 2: User Story 1 - Submit work (Priority: P1) 🎯 MVP

**Goal**: something

### Tests for User Story 1

- [ ] T002 [P] [US1] Tests
- [ ] T003 [US1] **(human)** Check by hand

**Checkpoint**: works

## Phase 3: Polish

- [ ] T010 Lint

## Dependencies and order

- T002 before T003.
`;

const messages = (md: string) =>
  validateTasks(md).map(({ line, message }) => `${line ?? '-'}: ${message}`);

describe('validateTasks', () => {
  it('accepts a file in the format, with prose, gaps in ids and sub-headings', () => {
    expect(validateTasks(VALID)).toEqual([]);
  });

  it('accepts a Convergence phase appended by /speckit-converge', () => {
    expect(
      validateTasks(
        `${VALID}\n## Phase 4: Convergence\n\n- [ ] T011 Fix gap\n`,
      ),
    ).toEqual([]);
  });

  it('refuses a file with no phase headings', () => {
    expect(messages('# Tasks\n\nNothing here.\n')).toEqual([
      '-: No phase headings found; each phase starts with "## Phase <number>: <title>"',
    ]);
  });

  it('refuses phase headings written another way', () => {
    for (const heading of [
      '## Phase 1 - Setup',
      '### Phase 1: Setup',
      '## Phase One: Setup',
      '## Phase 1:',
      '## phase 1: Setup',
    ]) {
      expect(messages(`${heading}\n\n- [ ] T001 x\n`)[0]).toBe(
        '1: A phase heading must be written "## Phase <number>: <title>"',
      );
    }
  });

  it('refuses task lines the reader would skip', () => {
    const md = (task: string) =>
      `## Phase 1: User Story 1 - A\n\n- [ ] T001 ok\n${task}\n`;
    for (const task of [
      '- [ ] Create the model',
      '- [ ] T1 short id',
      '- [ ] T0001 long id',
      '  - [ ] T002 indented',
      '* [ ] T002 other bullet',
      '- [] T002 no space in the box',
    ]) {
      expect(messages(md(task))).toEqual([
        '4: A task must be written "- [ ] T<3 digits> <description>", starting in the first column',
      ]);
    }
  });

  it('refuses a task above the first phase heading', () => {
    expect(
      messages(
        '- [ ] T001 stray\n\n## Phase 1: User Story 1 - A\n\n- [ ] T002 x\n',
      ),
    ).toEqual([
      '1: T001 is above the first phase heading, so it belongs to no phase',
    ]);
  });

  it('refuses a phase with no tasks', () => {
    expect(
      messages(
        '## Phase 1: Setup\n\n## Phase 2: User Story 1 - A\n\n- [ ] T001 x\n\n## Phase 3: Polish\n',
      ),
    ).toEqual(['1: Phase 1 has no tasks', '7: Phase 3 has no tasks']);
  });

  it('refuses a task id used twice', () => {
    expect(
      messages(
        '## Phase 1: User Story 1 - A\n\n- [ ] T002 x\n- [ ] T001 y\n- [ ] T002 z\n',
      ),
    ).toEqual(['5: T002 is used more than once']);
  });

  it('accepts a task added later that keeps its id, above lower ids', () => {
    expect(
      validateTasks(
        '## Phase 1: User Story 1 - A\n\n- [ ] T001 x\n- [ ] T047 added later\n- [ ] T002 y\n',
      ),
    ).toEqual([]);
  });

  it('refuses phase numbers that do not increase', () => {
    expect(
      messages(
        '## Phase 2: User Story 1 - A\n\n- [ ] T001 x\n\n## Phase 2: Polish\n\n- [ ] T002 y\n',
      ),
    ).toEqual([
      '5: Phase 2 comes after phase 2; phase numbers must increase down the file',
    ]);
  });

  it('refuses a file with no user story phase', () => {
    expect(messages('## Phase 1: Setup\n\n- [ ] T001 x\n')).toEqual([
      '-: No phase is titled "User Story <n> - ..."; the first story\'s phase marks where the first implementation issue ends',
    ]);
  });

  it('ignores headings and tasks inside fenced code blocks', () => {
    expect(
      validateTasks(
        `${VALID}\n\`\`\`text\n## Phase 9 - example\n- [ ] Create model\n- [ ] T001 [US1] Example\n\`\`\`\n`,
      ),
    ).toEqual([]);
  });
});

describe('formatProblem', () => {
  it('writes file:line: message for a terminal', () => {
    expect(
      formatProblem('specs/a/tasks.md', { line: 4, message: 'Bad' }, false),
    ).toBe('specs/a/tasks.md:4: Bad');
    expect(formatProblem('specs/a/tasks.md', { message: 'Bad' }, false)).toBe(
      'specs/a/tasks.md: Bad',
    );
  });

  it('writes an error annotation for GitHub Actions', () => {
    expect(
      formatProblem('specs/a/tasks.md', { line: 4, message: 'Bad' }, true),
    ).toBe('::error file=specs/a/tasks.md,line=4::Bad');
    expect(formatProblem('specs/a/tasks.md', { message: 'Bad' }, true)).toBe(
      '::error file=specs/a/tasks.md::Bad',
    );
  });
});
