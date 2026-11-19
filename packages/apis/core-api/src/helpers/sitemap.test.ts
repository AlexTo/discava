/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CoreTable } from '@discava/core-table';
import { describe, expect, it } from 'vitest';
import { sitemapEntries } from './sitemap.js';

const go = <T>(data: T) => ({ go: async () => ({ data }) });

const fakeTable = (opts: {
  courses: { courseId: string; status: string; updatedAt: string }[];
  members: Record<string, string[]>;
  profiles: Record<string, string>;
  categories: { slug: string; status: string; updatedAt: string }[];
}) =>
  ({
    entities: {
      course: {
        query: {
          byStatus: ({ status }: { status: string }) =>
            go(opts.courses.filter((course) => course.status === status)),
        },
      },
      courseInstructor: {
        query: {
          primary: ({ courseId }: { courseId: string }) =>
            go(
              (opts.members[courseId] ?? []).map((instructorId) => ({
                instructorId,
              })),
            ),
        },
      },
      instructorProfile: {
        get: (keys: { instructorId: string }[]) => ({
          go: async () => ({
            data: keys.flatMap(({ instructorId }) =>
              opts.profiles[instructorId]
                ? [
                    {
                      instructorId,
                      handle: opts.profiles[instructorId],
                      updatedAt: '2026-01-01T00:00:00.000Z',
                    },
                  ]
                : [],
            ),
            unprocessed: [],
          }),
        }),
      },
      category: { query: { primary: () => go(opts.categories) } },
    },
  }) as unknown as CoreTable;

describe('sitemapEntries', () => {
  it('lists published courses, profiles once and active categories only', async () => {
    const entries = await sitemapEntries(
      fakeTable({
        courses: [
          {
            courseId: 'a',
            status: 'published',
            updatedAt: '2026-03-01T00:00:00.000Z',
          },
          {
            courseId: 'b',
            status: 'published',
            updatedAt: '2026-04-01T00:00:00.000Z',
          },
          {
            courseId: 'draft',
            status: 'draft',
            updatedAt: '2026-05-01T00:00:00.000Z',
          },
        ],
        members: { a: ['i1'], b: ['i1', 'i2'], draft: ['i3'] },
        profiles: { i1: 'Ada', i2: 'bob', i3: 'carl' },
        categories: [
          {
            slug: 'cooking',
            status: 'active',
            updatedAt: '2026-02-01T00:00:00.000Z',
          },
          {
            slug: 'old',
            status: 'archived',
            updatedAt: '2026-02-01T00:00:00.000Z',
          },
        ],
      }),
    );
    const paths = entries.map((entry) => entry.path);
    expect(paths.sort()).toEqual([
      '/category/cooking',
      '/instructors/ada',
      '/instructors/bob',
      '/learn/a',
      '/learn/b',
    ]);
    expect(entries.find((e) => e.path === '/instructors/ada')?.lastmod).toBe(
      '2026-04-01T00:00:00.000Z',
    );
  });
});
