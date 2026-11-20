/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import { run } from './run.js';

// The entry point `nx run @discava/tooling-agent:post-merge-test` runs.
run({
  env: process.env,
  gh: (args) =>
    execFileSync('gh', args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  log: (message) => console.log(message),
});
