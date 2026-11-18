/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// Holds a pull request that changes who writes the core table until it also
// changes the invariant checks (core-table's helpers/invariants.ts), since a
// rule spanning records written by more than one package is what those
// checks are for (CONTRIBUTING.md, "Rules That Span Records"). It can't tell
// whether a rule is really at stake, so a maintainer waives it with a label
// when none is.

export const WAIVER_LABEL = 'no-new-invariant';

export const WRITER_MAP_PATH =
  'packages/databases/core-table/entity-writers.json';
export const INVARIANTS_PATH =
  'packages/databases/core-table/src/helpers/invariants.ts';

// The core-table helpers are where a shared rule is kept, so a new helper
// writing a shared entity isn't itself a reason to check again; a new
// write anywhere else is.
const HELPERS = 'core-table';

/** entity → writing package → the files in it that write the entity. */
export type WriterMap = Record<string, Record<string, string[]>>;

export interface Trigger {
  entity: string;
  reason: string;
}

const writersOf = (map: WriterMap, entity: string) =>
  Object.keys(map[entity] ?? {});

export const findTriggers = (before: WriterMap, after: WriterMap): Trigger[] =>
  Object.keys(after)
    .sort()
    .flatMap((entity): Trigger[] => {
      if (!(entity in before)) {
        return [{ entity, reason: 'is a new entity' }];
      }
      const writers = writersOf(after, entity);
      if (writers.length < 2) {
        return [];
      }
      const newWriters = writers.filter(
        (writer) => !writersOf(before, entity).includes(writer),
      );
      if (newWriters.length > 0) {
        return [
          {
            entity,
            reason: `is now written by ${newWriters.join(', ')} as well as ${writers
              .filter((writer) => !newWriters.includes(writer))
              .join(', ')}`,
          },
        ];
      }
      const newFiles = writers
        .filter((writer) => writer !== HELPERS)
        .flatMap((writer) =>
          after[entity][writer].filter(
            (file) => !before[entity][writer].includes(file),
          ),
        );
      return newFiles.length > 0
        ? [
            {
              entity,
              reason: `is written by ${writers.join(', ')}, and now also directly by ${newFiles.join(', ')}`,
            },
          ]
        : [];
    });

export type Verdict =
  | { ok: true; reason: string }
  | { ok: false; triggers: Trigger[] };

export const checkInvariantCoverage = (
  triggers: Trigger[],
  changedFiles: string[],
  labels: string[],
): Verdict => {
  if (triggers.length === 0) {
    return { ok: true, reason: 'no entity gained a writer' };
  }
  if (labels.includes(WAIVER_LABEL)) {
    return { ok: true, reason: `waived by the \`${WAIVER_LABEL}\` label` };
  }
  if (changedFiles.includes(INVARIANTS_PATH)) {
    return { ok: true, reason: `${INVARIANTS_PATH} changed` };
  }
  return { ok: false, triggers };
};

export const failureMessage = (triggers: Trigger[]): string =>
  [
    'This pull request changes who writes the core table:',
    ...triggers.map(({ entity, reason }) => `  - ${entity} ${reason}`),
    `If a rule now spans these writers, keep it in a core-table helper every writer calls and add a check to ${INVARIANTS_PATH} (CONTRIBUTING.md, "Rules That Span Records").`,
    `If no such rule is at stake, a maintainer adds the \`${WAIVER_LABEL}\` label and re-runs this job.`,
  ].join('\n');

// Two maps are the same whatever the key order or formatting.
export const sameWriterMap = (a: WriterMap, b: WriterMap): boolean =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const canonical = (map: WriterMap) =>
  Object.keys(map)
    .sort()
    .map((entity) => [
      entity,
      Object.keys(map[entity])
        .sort()
        .map((writer) => [writer, [...map[entity][writer]].sort()]),
    ]);
