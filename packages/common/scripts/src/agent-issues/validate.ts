/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { isStoryTitle, scanLines } from './tasks.js';

// Holds a tasks.md to the format tasks.ts reads. A file that strays from it
// isn't refused by the reader: its phases or tasks are skipped, so the agent
// would be handed the wrong tasks, or none. PR checks run this on every
// tasks.md, and the Agent Issues workflow refuses a file that fails it.

export interface Problem {
  /** The line it is on, from 1; none for a problem with the whole file. */
  line?: number;
  message: string;
}

export const validateTasks = (tasksMd: string): Problem[] => {
  const problems: Problem[] = [];
  const lines = scanLines(tasksMd);
  const phases = lines.filter((line) => line.kind === 'phase');

  let phase: (typeof phases)[number] | undefined;
  let tasksInPhase = 0;
  const seenIds = new Set<string>();
  const closePhase = () => {
    if (phase && tasksInPhase === 0) {
      problems.push({
        line: phase.line,
        message: `Phase ${phase.number} has no tasks`,
      });
    }
  };

  for (const line of lines) {
    switch (line.kind) {
      case 'malformed-phase':
        problems.push({
          line: line.line,
          message:
            'A phase heading must be written "## Phase <number>: <title>"',
        });
        break;
      case 'malformed-task':
        problems.push({
          line: line.line,
          message:
            'A task must be written "- [ ] T<3 digits> <description>", starting in the first column',
        });
        break;
      case 'phase':
        closePhase();
        if (phase && line.number <= phase.number) {
          problems.push({
            line: line.line,
            message: `Phase ${line.number} comes after phase ${phase.number}; phase numbers must increase down the file`,
          });
        }
        phase = line;
        tasksInPhase = 0;
        break;
      case 'task':
        if (!phase) {
          problems.push({
            line: line.line,
            message: `${line.id} is above the first phase heading, so it belongs to no phase`,
          });
        }
        if (seenIds.has(line.id)) {
          problems.push({
            line: line.line,
            message: `${line.id} is used more than once`,
          });
        }
        // Not their order: a task added later keeps its own id wherever it
        // is placed, and existing ids are never renumbered.
        seenIds.add(line.id);
        tasksInPhase++;
        break;
    }
  }
  closePhase();

  if (phases.length === 0) {
    problems.push({
      message:
        'No phase headings found; each phase starts with "## Phase <number>: <title>"',
    });
  } else if (!phases.some(({ title }) => isStoryTitle(title))) {
    problems.push({
      message:
        'No phase is titled "User Story <n> - ..."; the first story\'s phase marks where the first implementation issue ends',
    });
  }
  // In file order, with problems about the whole file last.
  return problems.sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity));
};

/**
 * One problem as a line of output: a GitHub Actions error annotation on the
 * file when `annotate`, else `file:line: message`. `file` is repo-relative.
 */
export const formatProblem = (
  file: string,
  { line, message }: Problem,
  annotate: boolean,
): string => {
  if (annotate) {
    return `::error file=${file}${line === undefined ? '' : `,line=${line}`}::${message}`;
  }
  return `${file}${line === undefined ? '' : `:${line}`}: ${message}`;
};
