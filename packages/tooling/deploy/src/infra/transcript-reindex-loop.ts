/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { parseArgs } from 'node:util';

/** What one call of the rebuild returns (`transcriptReindex`). */
export interface TranscriptReindexResult {
  courses: number;
  items: number;
  indexed: number;
  removed: number;
  cursor?: string;
}

/** One call of the rebuild: a Lambda invocation, or the handler in-process. */
export type InvokeReindex = (event: {
  courseId?: string;
  cursor?: string;
}) => Promise<TranscriptReindexResult>;

/**
 * The `--stage` and `--course` a run is asked for. `nx run` may pass a `--`
 * separator through.
 */
export const parseReindexArgs = (
  args: string[],
): { stage?: string; course?: string } => {
  const { values } = parseArgs({
    args: args.filter((arg) => arg !== '--'),
    options: {
      stage: { type: 'string' },
      course: { type: 'string' },
    },
    strict: true,
  });
  if (values.course !== undefined && !/^[A-Za-z0-9_-]+$/.test(values.course)) {
    throw new Error(`"${values.course}" is not a course id`);
  }
  return values;
};

/**
 * Calls the rebuild again for as long as it hands back a cursor, and returns
 * the totals of every call.
 */
export const reindexUntilDone = async (
  invoke: InvokeReindex,
  courseId?: string,
): Promise<Omit<TranscriptReindexResult, 'cursor'> & { calls: number }> => {
  const totals = { courses: 0, items: 0, indexed: 0, removed: 0, calls: 0 };
  let cursor: string | undefined;
  do {
    const result = await invoke({
      ...(courseId && { courseId }),
      ...(cursor && { cursor }),
    });
    totals.calls++;
    totals.courses += result.courses;
    totals.items += result.items;
    totals.indexed += result.indexed;
    totals.removed += result.removed;
    cursor = result.cursor;
  } while (cursor);
  return totals;
};
