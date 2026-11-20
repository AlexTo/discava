/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Every entity's records are loaded into the TableSnapshot that the
// invariant checks (and the e2e suite after every scenario) read, so a new
// entity can't arrive without someone deciding which rules it keeps. An
// entity with nothing to check goes here, with the reason; the reviewer
// judges the reason. See CONTRIBUTING.md's "Rules That Span Records".
const NO_INVARIANTS: Record<string, string> = {
  'analytics-marker':
    'only guards the analytics stream against counting an event twice; the aggregates it guards are checked',
  'submission-notice':
    'only deduplicates the daily instructor notice; the notifications it guards are checked',
};

const src = path.join(import.meta.dirname, '..');

const entityFiles = readdirSync(path.join(src, 'entities'))
  .filter(
    (file) =>
      file.endsWith('.ts') && !file.endsWith('.test.ts') && file !== 'index.ts',
  )
  .map((file) => file.replace(/\.ts$/, ''))
  .sort();

const factoryName = (entityFile: string) =>
  `create${entityFile
    .split('-')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('')}Entity`;

const invariants = readFileSync(
  path.join(src, 'helpers', 'invariants', 'snapshot.ts'),
  'utf8',
);

describe('invariant coverage', () => {
  it('loads every entity into the TableSnapshot', () => {
    const missing = entityFiles.filter(
      (entity) =>
        !(entity in NO_INVARIANTS) &&
        !new RegExp(`Item<\\s*typeof ${factoryName(entity)}\\s*>`).test(
          invariants,
        ),
    );
    // A new entity: add its records to TableSnapshot and SNAPSHOT_ENTITIES in
    // helpers/invariants/snapshot.ts (and a check for each rule it keeps), or list it in NO_INVARIANTS above.
    expect(missing).toEqual([]);
  });

  it('lists only entities that exist and are not already covered', () => {
    const stale = Object.keys(NO_INVARIANTS).filter(
      (entity) =>
        !entityFiles.includes(entity) ||
        new RegExp(`Item<\\s*typeof ${factoryName(entity)}\\s*>`).test(
          invariants,
        ),
    );
    expect(stale).toEqual([]);
  });
});
