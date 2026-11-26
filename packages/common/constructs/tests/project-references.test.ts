/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

// Nx's typescript-sync generator expects a project reference for every
// workspace dependency; without one, `nx run` refuses to start locally with
// "The workspace is out of sync" (CI doesn't check, so it only shows there).
describe('tsconfig.lib.json project references', () => {
  it('reference every workspace package the package.json depends on', () => {
    const pkg = readJson(join(root, 'package.json'));
    const workspaceDeps = Object.entries({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    })
      .filter(([, version]) => String(version).startsWith('workspace:'))
      .map(([name]) => name)
      .sort();

    const referenced = readJson(join(root, 'tsconfig.lib.json'))
      .references.map(
        ({ path }: { path: string }) =>
          readJson(join(root, dirname(path), 'package.json')).name as string,
      )
      .sort();

    expect(referenced).toEqual(workspaceDeps);
  });
});
