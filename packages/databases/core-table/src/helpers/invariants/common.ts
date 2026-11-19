/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { TableSnapshot } from './snapshot.js';

// What every topic file builds on. The rules the core table must keep that
// span several records, or several writers (core-api, instructor-api, the
// event handlers), and that no schema enforces (#57), are checks: each reads
// a snapshot of the table and returns every record that breaks its rule;
// nothing here writes.

export interface Violation {
  invariant: string;
  message: string;
  // The record's key, enough to find it in the table.
  record: Record<string, string>;
}

// A topic file lists its checks as `{ name, check }`, in `index.ts`'s order.
export interface Check {
  name: string;
  check: (snapshot: TableSnapshot) => Violation[];
}

export const violation = (
  invariant: string,
  record: Record<string, string>,
  message: string,
): Violation => ({ invariant, record, message });

// Every record a student's work in a course leaves, with its key: their
// completions, quiz attempts, quiz summaries and assignment submissions.
export const studentRecords = (snapshot: TableSnapshot) => [
  ...snapshot.itemCompletions.map((r) => ({
    ...r,
    kind: 'completion',
    key: {
      userId: r.userId,
      courseId: r.courseId,
      contentItemId: r.contentItemId,
    },
  })),
  ...snapshot.quizAttempts.map((r) => ({
    ...r,
    kind: 'quiz attempt',
    key: {
      userId: r.userId,
      courseId: r.courseId,
      contentItemId: r.contentItemId,
      attemptId: r.attemptId,
    },
  })),
  ...snapshot.quizSummaries.map((r) => ({
    ...r,
    kind: 'quiz summary',
    key: {
      userId: r.userId,
      courseId: r.courseId,
      contentItemId: r.contentItemId,
    },
  })),
  ...snapshot.assignmentSubmissions.map((r) => ({
    ...r,
    kind: 'submission',
    key: {
      userId: r.userId,
      courseId: r.courseId,
      contentItemId: r.contentItemId,
    },
  })),
];

export const groupBy = <T, K>(items: T[], key: (item: T) => K) => {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  }
  return groups;
};
