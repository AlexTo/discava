/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// Reads a feature's `tasks.md` (written by /speckit-tasks) into the units an
// implementing agent is handed one at a time: one issue per group of phases.

export interface Task {
  id: string;
  done: boolean;
  /** Needs a running local stack or people, so the agent skips it. */
  human: boolean;
}

export interface Phase {
  number: number;
  /** The heading without its "Phase N:" prefix, e.g. "User Story 1 - Submit". */
  title: string;
  isStory: boolean;
  tasks: Task[];
}

export interface TaskGroup {
  /** Position in the feature's list of groups; part of the issue's marker. */
  index: number;
  title: string;
  phases: Phase[];
  tasks: Task[];
}

const PHASE_HEADING = /^## Phase (\d+): (.+?)\s*$/;
const TASK_LINE = /^- \[([ xX])\] (T\d{3})\b(.*)$/;

export const parsePhases = (tasksMd: string): Phase[] => {
  const phases: Phase[] = [];
  for (const line of tasksMd.split('\n')) {
    const heading = PHASE_HEADING.exec(line);
    if (heading) {
      const title = heading[2];
      phases.push({
        number: Number(heading[1]),
        title,
        isStory: title.startsWith('User Story'),
        tasks: [],
      });
      continue;
    }
    const task = TASK_LINE.exec(line);
    if (task && phases.length > 0) {
      phases[phases.length - 1].tasks.push({
        id: task[2],
        done: task[1] !== ' ',
        human: task[3].includes('**(human)**'),
      });
    }
  }
  return phases;
};

// "User Story 1 - Submit work (Priority: P1) 🎯 MVP" -> "Submit work".
const shortTitle = ({ title }: Phase): string =>
  title
    .replace(/^User Story \d+ - /, '')
    .replace(/\s*\((?:Priority: )?P\d\).*$/, '')
    .replace(/\s*\(blocks every story\)$/, '')
    .trim();

/**
 * One group for everything up to and including the first user story (setup,
 * foundations and the MVP story), then one group per later phase.
 */
export const groupPhases = (phases: Phase[]): TaskGroup[] => {
  const batches: Phase[][] = [];
  const firstStory = phases.findIndex((phase) => phase.isStory);
  if (firstStory >= 0) {
    batches.push(phases.slice(0, firstStory + 1));
    for (const phase of phases.slice(firstStory + 1)) {
      batches.push([phase]);
    }
  } else {
    batches.push(...phases.map((phase) => [phase]));
  }
  return batches.map((batch, index) => {
    const last = batch[batch.length - 1];
    const title =
      batch.length > 1
        ? `${shortTitle(last)} (with setup and foundations)`
        : shortTitle(last);
    return {
      index,
      title,
      phases: batch,
      tasks: batch.flatMap((phase) => phase.tasks),
    };
  });
};

/** The first group with work left for the agent (human tasks don't count). */
export const nextGroup = (groups: TaskGroup[]): TaskGroup | undefined =>
  groups.find((group) => group.tasks.some((task) => !task.done && !task.human));
