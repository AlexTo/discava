/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run } from './archive-specs.js';

// The entry point `nx run @discava/common-scripts:archive-specs` runs.
const cwd =
  process.env.GITHUB_WORKSPACE ??
  fileURLToPath(new URL('../../../../../', import.meta.url));
const exec = (command: string) => (args: string[]) =>
  execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

run({
  env: { ...process.env, GITHUB_WORKSPACE: cwd },
  gh: exec('gh'),
  git: exec('git'),
  log: (message) => console.log(message),
});
