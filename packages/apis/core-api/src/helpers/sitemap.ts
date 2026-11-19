/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CoreTable } from '@discava/core-table';
import { readCategories } from './category-list.js';

export interface SitemapEntry {
  path: string;
  /** ISO timestamp of the last change. */
  lastmod: string;
}

// Membership queries in flight at once: enough to be quick, few enough not to
// spend the table's read capacity on one sitemap.
const MAX_IN_FLIGHT = 10;
const BATCH_READ_ATTEMPTS = 3;

const mapWithLimit = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
};

/**
 * Every public address: a published course's page, a public profile (an
 * instructor of a published course) and an active category's page. Paths are
 * unique; `lastmod` is the latest change among what a path shows.
 */
export const sitemapEntries = async (
  coreTable: CoreTable,
): Promise<SitemapEntry[]> => {
  const [{ data: courses }, categories] = await Promise.all([
    coreTable.entities.course.query
      .byStatus({ status: 'published' })
      .go({ pages: 'all' }),
    readCategories(coreTable),
  ]);

  const memberships = await mapWithLimit(courses, MAX_IN_FLIGHT, (course) =>
    coreTable.entities.courseInstructor.query
      .primary({ courseId: course.courseId })
      .go({ pages: 'all' })
      .then(({ data }) => data),
  );

  // The latest update among the published courses an instructor teaches.
  const instructorUpdated = new Map<string, string>();
  courses.forEach((course, index) => {
    for (const { instructorId } of memberships[index] ?? []) {
      const seen = instructorUpdated.get(instructorId);
      if (seen === undefined || course.updatedAt > seen) {
        instructorUpdated.set(instructorId, course.updatedAt);
      }
    }
  });

  const profiles: {
    handle: string;
    updatedAt?: string;
    instructorId: string;
  }[] = [];
  let pending = [...instructorUpdated.keys()].map((instructorId) => ({
    instructorId,
  }));
  for (let attempt = 0; pending.length > 0; attempt++) {
    if (attempt === BATCH_READ_ATTEMPTS) {
      throw new Error('Instructor profiles could not be read: throttled');
    }
    const { data, unprocessed } = await coreTable.entities.instructorProfile
      .get(pending)
      .go();
    profiles.push(...data);
    pending = unprocessed;
  }

  const entries = new Map<string, string>();
  for (const course of courses) {
    entries.set(`/learn/${course.courseId}`, course.updatedAt);
  }
  for (const profile of profiles) {
    const courseUpdated = instructorUpdated.get(profile.instructorId) ?? '';
    const lastmod =
      profile.updatedAt && profile.updatedAt > courseUpdated
        ? profile.updatedAt
        : courseUpdated;
    entries.set(`/instructors/${profile.handle.toLowerCase()}`, lastmod);
  }
  for (const category of categories) {
    if (category.status === 'active') {
      entries.set(`/category/${category.slug}`, category.updatedAt);
    }
  }
  return [...entries].map(([path, lastmod]) => ({ path, lastmod }));
};
