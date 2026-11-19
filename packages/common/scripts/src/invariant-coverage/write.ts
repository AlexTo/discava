/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { WRITER_MAP_PATH } from './check.js';
import { scanEntityWriters, WORKSPACE_ROOT } from './scan.js';

// `nx run @discava/common-scripts:entity-writers`: rewrites core-table's
// entity-writers.json from the code. Run it after changing which code writes
// the core table, and commit the result; the `Invariant coverage` check
// fails while the file is out of date.
const file = path.join(WORKSPACE_ROOT, WRITER_MAP_PATH);
writeFileSync(file, `${JSON.stringify(scanEntityWriters(), null, 2)}\n`);
// As Biome would leave it, so `lint` doesn't then rewrite it.
execFileSync('pnpm', ['exec', 'biome', 'format', '--write', file], {
  cwd: WORKSPACE_ROOT,
  stdio: 'ignore',
});
console.log(`Wrote ${WRITER_MAP_PATH}`);
