/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatProblem, validateTasks } from './validate.js';

// The entry point `nx run @discava/common-scripts:validate-tasks` runs: checks
// every specs/<folder>/tasks.md against the format the Agent Issues workflow
// reads (see validate.ts), and exits 1 if any strays from it.

const root =
  process.env.GITHUB_WORKSPACE ??
  fileURLToPath(new URL('../../../../../', import.meta.url));
const annotate = process.env.GITHUB_ACTIONS === 'true';
const specs = join(root, 'specs');

const files = (existsSync(specs) ? readdirSync(specs) : [])
  .map((folder) => `specs/${folder}/tasks.md`)
  .filter((file) => existsSync(join(root, file)))
  .sort();

let failed = 0;
for (const file of files) {
  const problems = validateTasks(readFileSync(join(root, file), 'utf8'));
  if (problems.length > 0) {
    failed++;
  }
  for (const problem of problems) {
    console.log(formatProblem(file, problem, annotate));
  }
}

if (failed > 0) {
  console.error(
    `${failed} of ${files.length} tasks.md file(s) are not in the format the Agent Issues workflow reads. See .specify/templates/tasks-template.md.`,
  );
  process.exit(1);
}
console.log(`${files.length} tasks.md file(s) are in the expected format.`);
