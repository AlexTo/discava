/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHIVE_FOLDER } from './issue.js';
import {
  formatProblem,
  type Problem,
  validateArchivedTasks,
  validateTasks,
} from './validate.js';

// The entry point `nx run @discava/common-scripts:validate-tasks` runs: checks
// every specs/<folder>/tasks.md against the format the Agent Issues workflow
// reads (see validate.ts), and every specs/_archive/<folder>/tasks.md for a
// task left unticked, and exits 1 if any fails.

const root =
  process.env.GITHUB_WORKSPACE ??
  fileURLToPath(new URL('../../../../../', import.meta.url));
const annotate = process.env.GITHUB_ACTIONS === 'true';
const tasksFiles = (dir: string): string[] =>
  (existsSync(join(root, dir)) ? readdirSync(join(root, dir)) : [])
    .filter((folder) => folder !== ARCHIVE_FOLDER)
    .map((folder) => `${dir}/${folder}/tasks.md`)
    .filter((file) => existsSync(join(root, file)))
    .sort();

const checks: [string[], (tasksMd: string) => Problem[]][] = [
  [tasksFiles('specs'), validateTasks],
  [tasksFiles(`specs/${ARCHIVE_FOLDER}`), validateArchivedTasks],
];

let failed = 0;
let total = 0;
for (const [files, validate] of checks) {
  total += files.length;
  for (const file of files) {
    const problems = validate(readFileSync(join(root, file), 'utf8'));
    if (problems.length > 0) {
      failed++;
    }
    for (const problem of problems) {
      console.log(formatProblem(file, problem, annotate));
    }
  }
}

if (failed > 0) {
  console.error(
    `${failed} of ${total} tasks.md file(s) failed: a live spec's must be in the format the Agent Issues workflow reads (see .specify/templates/tasks-template.md), and an archived spec's must have every task ticked.`,
  );
  process.exit(1);
}
console.log(`${total} tasks.md file(s) passed.`);
