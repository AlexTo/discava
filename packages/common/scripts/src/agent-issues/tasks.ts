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
  /** What the group delivers: its last phase's title, shortened. */
  title: string;
  /** Whether it also carries the setup and foundational phases. */
  withFoundations: boolean;
  phases: Phase[];
  tasks: Task[];
}

// The format, which validate.ts holds every tasks.md to:
// - a phase is a heading `## Phase <number>: <title>`;
// - a task is a line `- [ ] T<3 digits> <description>` (`[x]` once done),
//   starting in the first column, under a phase;
// - a story's phase is titled `User Story <n> - <what it delivers>`.
const PHASE_HEADING = /^## Phase (\d+): (.+?)\s*$/;
// "(human)", bold or not: the constitution and the tasks template write it
// differently.
const HUMAN_MARK = /\(human\)/i;
const TASK_LINE = /^- \[([ xX])\] (T\d{3})\b(.*)$/;
// What was probably meant as a phase heading or a task, to catch the ones
// the two patterns above would silently skip.
const PHASE_LIKE = /^\s*#{1,6}\s+Phase\b/i;
const TASK_LIKE = /^\s*[-*+] \[[ xX]?\]/;
const FENCE = /^\s*(```|~~~)/;

/** A line of tasks.md that is, or looks like, a phase heading or a task. */
export type TasksLine =
  | { kind: 'phase'; line: number; number: number; title: string }
  | { kind: 'task'; line: number; id: string; done: boolean; human: boolean }
  | { kind: 'malformed-phase' | 'malformed-task'; line: number };

/**
 * The phase headings and tasks of a tasks.md in file order, with their line
 * numbers (from 1), plus the lines that look like one but aren't written in
 * the format. Fenced code blocks are skipped.
 */
export const scanLines = (tasksMd: string): TasksLine[] => {
  const lines: TasksLine[] = [];
  let fenced = false;
  tasksMd.split('\n').forEach((text, index) => {
    const line = index + 1;
    if (FENCE.test(text)) {
      fenced = !fenced;
      return;
    }
    if (fenced) {
      return;
    }
    const heading = PHASE_HEADING.exec(text);
    if (heading) {
      lines.push({
        kind: 'phase',
        line,
        number: Number(heading[1]),
        title: heading[2],
      });
      return;
    }
    const task = TASK_LINE.exec(text);
    if (task) {
      lines.push({
        kind: 'task',
        line,
        id: task[2],
        done: task[1] !== ' ',
        human: HUMAN_MARK.test(task[3]),
      });
      return;
    }
    if (PHASE_LIKE.test(text)) {
      lines.push({ kind: 'malformed-phase', line });
    } else if (TASK_LIKE.test(text)) {
      lines.push({ kind: 'malformed-task', line });
    }
  });
  return lines;
};

export const isStoryTitle = (title: string): boolean =>
  title.startsWith('User Story');

export const parsePhases = (tasksMd: string): Phase[] => {
  const phases: Phase[] = [];
  for (const line of scanLines(tasksMd)) {
    if (line.kind === 'phase') {
      phases.push({
        number: line.number,
        title: line.title,
        isStory: isStoryTitle(line.title),
        tasks: [],
      });
    } else if (line.kind === 'task' && phases.length > 0) {
      phases[phases.length - 1].tasks.push({
        id: line.id,
        done: line.done,
        human: line.human,
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
    return {
      index,
      title: shortTitle(batch[batch.length - 1]),
      withFoundations: batch.length > 1,
      phases: batch,
      tasks: batch.flatMap((phase) => phase.tasks),
    };
  });
};

/** A group's tasks the agent still has to do (human tasks don't count). */
export const openAgentTasks = (group: TaskGroup): Task[] =>
  group.tasks.filter((task) => !task.done && !task.human);

/** The first group with work left for the agent. */
export const nextGroup = (groups: TaskGroup[]): TaskGroup | undefined =>
  groups.find((group) => openAgentTasks(group).length > 0);
