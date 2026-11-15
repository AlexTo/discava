/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  groupPhases,
  nextGroup,
  openAgentTasks,
  parsePhases,
} from './tasks.js';

const TASKS = `# Tasks

## Phase 1: Setup

- [x] T001 Add dependencies

## Phase 2: Foundational (blocks every story)

- [x] T002 Move code
- [ ] T003 [P] Move tests

## Phase 3: User Story 1 - Submit work (Priority: P1) 🎯 MVP

- [ ] T004 [US1] Procedure
- [ ] T005 [US1] Form

## Phase 4: User Story 2 - Resubmit (P2)

- [ ] T006 [US2] Resubmit

## Phase 7: Polish and cross-cutting

- [ ] T007 Lint
- [ ] T008 **(human)** Run quickstart by hand
`;

describe('parsePhases', () => {
  it('reads phases, tasks, done marks and human tasks', () => {
    const phases = parsePhases(TASKS);
    expect(phases.map((p) => p.number)).toEqual([1, 2, 3, 4, 7]);
    expect(phases[2].isStory).toBe(true);
    expect(phases[0].isStory).toBe(false);
    expect(phases[1].tasks).toEqual([
      { id: 'T002', done: true, human: false },
      { id: 'T003', done: false, human: false },
    ]);
    expect(phases[4].tasks[1]).toEqual({
      id: 'T008',
      done: false,
      human: true,
    });
  });

  it('recognises a human task with or without bold', () => {
    const [phase] = parsePhases(
      '## Phase 1: A\n\n- [ ] T001 (human) check\n- [ ] T002 **(Human)** look\n- [ ] T003 humans welcome\n',
    );
    expect(phase.tasks.map((task) => task.human)).toEqual([true, true, false]);
  });

  it('ignores tasks before the first phase heading', () => {
    expect(parsePhases('- [ ] T001 stray\n')).toEqual([]);
  });
});

describe('groupPhases', () => {
  const groups = groupPhases(parsePhases(TASKS));

  it('puts setup, foundations and the first story in one group', () => {
    expect(groups[0].phases.map((p) => p.number)).toEqual([1, 2, 3]);
    expect(groups[0].title).toBe('Submit work');
    expect(groups[0].withFoundations).toBe(true);
    expect(groups[0].tasks.map((t) => t.id)).toEqual([
      'T001',
      'T002',
      'T003',
      'T004',
      'T005',
    ]);
  });

  it('gives each later phase its own group', () => {
    expect(groups.map((g) => g.index)).toEqual([0, 1, 2]);
    expect(groups[1].title).toBe('Resubmit');
    expect(groups[1].withFoundations).toBe(false);
    expect(groups[2].title).toBe('Polish and cross-cutting');
  });

  it('makes one group per phase when no phase is a user story', () => {
    const only = groupPhases(parsePhases('## Phase 1: A\n\n- [ ] T001 x\n'));
    expect(only).toHaveLength(1);
    expect(only[0].title).toBe('A');
  });
});

describe('openAgentTasks', () => {
  it('lists unticked tasks that are not for a person', () => {
    const groups = groupPhases(parsePhases(TASKS));
    expect(openAgentTasks(groups[0]).map((task) => task.id)).toEqual([
      'T003',
      'T004',
      'T005',
    ]);
    expect(openAgentTasks(groups[2]).map((task) => task.id)).toEqual(['T007']);
  });
});

describe('nextGroup', () => {
  it('is the first group with agent work left', () => {
    const groups = groupPhases(parsePhases(TASKS));
    expect(nextGroup(groups)?.index).toBe(0);
  });

  it('moves on once a group is done', () => {
    const done = TASKS.replaceAll('- [ ] T00', '- [x] T00').replace(
      '- [x] T008',
      '- [ ] T008',
    );
    const groups = groupPhases(parsePhases(done));
    expect(nextGroup(groups)).toBeUndefined();
  });

  it('skips a group that only has human tasks left', () => {
    const md = `## Phase 1: A\n\n- [x] T001 x\n\n## Phase 2: User Story 1 - B\n\n- [ ] T002 **(human)** check\n\n## Phase 3: User Story 2 - C\n\n- [ ] T003 y\n`;
    expect(nextGroup(groupPhases(parsePhases(md)))?.title).toBe('C');
  });

  it('is undefined when nothing is left', () => {
    expect(nextGroup([])).toBeUndefined();
  });
});
