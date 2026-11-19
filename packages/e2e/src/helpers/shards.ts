/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readdirSync, readFileSync } from 'node:fs';

const SRC = new URL('../', import.meta.url);
const TEST_DIRS = ['concurrency', 'scenarios'];

// Seconds each test file took in a CI run, by its path under src/. Only
// roughly right, which is enough to share the work out; a file that isn't
// listed counts as a typical one.
const durations: Record<string, number> = JSON.parse(
  readFileSync(new URL('../../shard-durations.json', import.meta.url), 'utf8'),
);

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 1;
};

// The test files one CI runner of `total` runs, as `testMatch` patterns: the
// longest file goes to whichever runner has the least so far, then the next
// longest, and so on. Every runner works the same split out for itself, so
// between them they run each file exactly once.
export const shardFiles = (current: number, total: number): string[] => {
  if (!(current >= 1 && current <= total)) {
    throw new Error(`E2E_SHARD: ${current}/${total} isn't a shard`);
  }
  const files = TEST_DIRS.flatMap((dir) =>
    (readdirSync(new URL(`${dir}/`, SRC), { recursive: true }) as string[])
      .filter((file) => file.endsWith('.e2e.ts'))
      .map((file) => `${dir}/${file.replaceAll('\\', '/')}`),
  ).sort();
  const typical = median(Object.values(durations));
  const weight = (file: string) => durations[file] ?? typical;

  const shards = Array.from({ length: total }, () => ({
    seconds: 0,
    files: [] as string[],
  }));
  const longestFirst = [...files].sort(
    (a, b) => weight(b) - weight(a) || a.localeCompare(b),
  );
  for (const file of longestFirst) {
    const least = shards.reduce((a, b) => (b.seconds < a.seconds ? b : a));
    least.seconds += weight(file);
    least.files.push(file);
  }
  // A runner given nothing (more runners than files) must match nothing, and
  // an empty `testMatch` would match Playwright's defaults.
  const mine = shards[current - 1].files;
  return mine.length > 0 ? mine.map((file) => `**/${file}`) : ['no-files'];
};
