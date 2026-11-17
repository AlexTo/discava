/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { createCoreTableService } from '../service.js';
import { dayKey, weekKey } from './analytics.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

// DynamoDB's limit on the keys of one batch get.
const BATCH_SIZE = 100;
const BATCH_ATTEMPTS = 3;

export interface CourseSummary {
  courseId: string;
  enrolments: number;
  completed: number;
  dropped: number;
  /** Learners active in the current UTC calendar week. */
  activeLearners: number;
  /** When the course's analytics last changed; null when they never have. */
  updatedAt: string | null;
}

// A late or reordered event can leave a counter below zero for a moment; it
// is never shown.
const counter = (value: number | undefined) => Math.max(0, value ?? 0);

// Batch gets `keys` in groups of BATCH_SIZE, asking again for what DynamoDB
// left unprocessed, and failing rather than showing zeros for it.
const batchGet = async <Key, Item>(
  keys: Key[],
  get: (keys: Key[]) => Promise<{ data: Item[]; unprocessed: Key[] }>,
): Promise<Item[]> => {
  const items: Item[] = [];
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    let pending = keys.slice(i, i + BATCH_SIZE);
    for (let attempt = 0; pending.length > 0; attempt++) {
      if (attempt === BATCH_ATTEMPTS) {
        throw new Error('Analytics could not be read: throttled');
      }
      const { data, unprocessed } = await get(pending);
      items.push(...data);
      pending = unprocessed;
    }
  }
  return items;
};

/**
 * The figures behind the dashboard's cards, for each course, in the order
 * given: one batch get of the summaries and one of this week's items, however
 * many students the courses have. A course with no items gets zeros.
 */
export const readCourseSummaries = async (
  coreTable: CoreTable,
  courseIds: string[],
  now = new Date(),
): Promise<CourseSummary[]> => {
  if (courseIds.length === 0) {
    return [];
  }
  const { courseStats, periodStats } = coreTable.entities;
  const periodKey = weekKey(now.toISOString()) as string;

  const [summaries, weeks] = await Promise.all([
    batchGet(
      courseIds.map((courseId) => ({ courseId })),
      async (keys) => {
        const { data, unprocessed } = await courseStats.get(keys).go();
        return { data, unprocessed };
      },
    ),
    batchGet(
      courseIds.map((courseId) => ({ courseId, periodKey })),
      async (keys) => {
        const { data, unprocessed } = await periodStats.get(keys).go();
        return { data, unprocessed };
      },
    ),
  ]);

  const summaryOf = new Map(summaries.map((item) => [item.courseId, item]));
  const weekOf = new Map(weeks.map((item) => [item.courseId, item]));
  return courseIds.map((courseId) => {
    const summary = summaryOf.get(courseId);
    return {
      courseId,
      enrolments: counter(summary?.enrolments),
      completed: counter(summary?.completed),
      dropped: counter(summary?.dropped),
      activeLearners: counter(weekOf.get(courseId)?.activeLearners),
      updatedAt: summary?.updatedAt ?? null,
    };
  });
};

export interface CourseDay {
  /** The UTC day, `yyyy-mm-dd`. */
  date: string;
  enrolments: number;
  activeLearners: number;
}

export interface CourseAnalytics extends CourseSummary {
  /** Enrolled and neither completed nor dropped; never below 0. */
  active: number;
  /** Exactly the days asked for, oldest first, zero filled. */
  daily: CourseDay[];
}

const DAY_MS = 86_400_000;

/**
 * One course's totals and its last `days` UTC days (today included), from the
 * summary item, this week's item and one range query over the day items.
 */
export const readCourseAnalytics = async (
  coreTable: CoreTable,
  courseId: string,
  days: number,
  now = new Date(),
): Promise<CourseAnalytics> => {
  const dates = Array.from({ length: days }, (_, i) =>
    new Date(now.getTime() - (days - 1 - i) * DAY_MS)
      .toISOString()
      .slice(0, 10),
  );
  const [[summary], { data: items }] = await Promise.all([
    readCourseSummaries(coreTable, [courseId], now),
    coreTable.entities.periodStats.query
      .primary({ courseId })
      .between(
        { periodKey: dayKey(dates[0]) as string },
        { periodKey: dayKey(dates[days - 1]) as string },
      )
      .go({ pages: 'all' }),
  ]);

  const dayOf = new Map(items.map((item) => [item.periodKey, item]));
  return {
    ...summary,
    active: Math.max(
      0,
      summary.enrolments - summary.completed - summary.dropped,
    ),
    daily: dates.map((date) => {
      const item = dayOf.get(`DAY#${date}`);
      return {
        date,
        enrolments: counter(item?.enrolments),
        activeLearners: counter(item?.activeLearners),
      };
    }),
  };
};
