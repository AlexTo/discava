/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { instructorProfilePublicView } from './instructor-profile.js';

const { claimGet, profileGet, membershipsQuery, courseGet, ratingGet } =
  vi.hoisted(() => ({
    claimGet: vi.fn(),
    profileGet: vi.fn(),
    membershipsQuery: vi.fn(),
    courseGet: vi.fn(),
    ratingGet: vi.fn(),
  }));

vi.mock('@discava/core-table', async (importActual) => ({
  ...(await importActual<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: {
      profileHandleClaim: { get: claimGet },
      instructorProfile: { get: profileGet },
      courseInstructor: { query: { byInstructor: membershipsQuery } },
      course: { get: courseGet },
      courseRating: { get: ratingGet },
    },
  })),
}));

const caller = t.createCallerFactory(
  t.router({ publicView: instructorProfilePublicView }),
);
const anonymous = () =>
  caller({
    event: { requestContext: {} } as unknown as APIGatewayProxyEvent,
    context: {} as any,
    info: {} as any,
  });

const profile = {
  instructorId: 'instructor-1',
  handle: 'alex-to',
  displayName: 'Alex To',
  headline: 'Teacher',
  bio: 'One\n\nTwo',
  photoKey: 'instructors/instructor-1/x.jpg',
  version: 3,
  createdAt: 'a',
  updatedAt: 'b',
};
const course = (courseId: string, status: string, publishedAt?: string) => ({
  courseId,
  title: `Course ${courseId}`,
  status,
  publishedAt,
  imageKey: `courses/${courseId}/image/x.jpg`,
  certificatesEnabled: true,
  createdAt: 'a',
  updatedAt: 'b',
});

const go = <T>(data: T) => ({ go: async () => data });

beforeEach(() => {
  vi.resetAllMocks();
  claimGet.mockReturnValue(
    go({ data: { handle: 'alex-to', instructorId: 'instructor-1' } }),
  );
  profileGet.mockReturnValue(go({ data: profile }));
  membershipsQuery.mockReturnValue(
    go({ data: [{ courseId: 'c1' }, { courseId: 'c2' }, { courseId: 'c3' }] }),
  );
  courseGet.mockReturnValue(
    go({
      data: [
        course('c1', 'published', '2026-01-01T00:00:00.000Z'),
        course('c2', 'published', '2026-03-01T00:00:00.000Z'),
        course('c3', 'draft'),
      ],
    }),
  );
  ratingGet.mockReturnValue(go({ data: [], unprocessed: [] }));
});

describe('instructorProfile.publicView', () => {
  it('returns the profile with published courses, newest first', async () => {
    const result = await anonymous().publicView({ handle: 'alex-to' });

    expect(result).toMatchObject({
      handle: 'alex-to',
      displayName: 'Alex To',
      headline: 'Teacher',
      bio: 'One\n\nTwo',
      photoKey: 'instructors/instructor-1/x.jpg',
    });
    expect(result.courses.map((c) => c.courseId)).toEqual(['c2', 'c1']);
    expect(result.courses[0]).toEqual({
      courseId: 'c2',
      title: 'Course c2',
      imageKey: 'courses/c2/image/x.jpg',
      ratingCount: 0,
    });
  });

  it('lower-cases the handle before looking it up', async () => {
    await anonymous().publicView({ handle: 'Alex-To' });
    expect(claimGet).toHaveBeenCalledWith({ handle: 'alex-to' });
  });

  it('never lists draft or archived courses, nor a deleted one', async () => {
    courseGet.mockReturnValue(
      go({
        data: [
          course('c1', 'archived', '2026-01-01T00:00:00.000Z'),
          null,
          course('c3', 'published', '2026-02-01T00:00:00.000Z'),
        ],
      }),
    );
    const result = await anonymous().publicView({ handle: 'alex-to' });
    expect(result.courses.map((c) => c.courseId)).toEqual(['c3']);
  });

  it('keeps at most 100 courses', async () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      course(`c${i}`, 'published', new Date(2026, 0, 1, 0, i).toISOString()),
    );
    courseGet.mockReturnValue(go({ data: many }));
    membershipsQuery.mockReturnValue(
      go({ data: many.map(({ courseId }) => ({ courseId })) }),
    );
    const result = await anonymous().publicView({ handle: 'alex-to' });
    expect(result.courses).toHaveLength(100);
    expect(result.courses[0].courseId).toBe('c119');
  });

  it('adds each course’s rating', async () => {
    ratingGet.mockReturnValue(
      go({
        data: [
          {
            courseId: 'c2',
            stars5: 1,
            stars4: 1,
            stars3: 0,
            stars2: 0,
            stars1: 0,
          },
        ],
        unprocessed: [],
      }),
    );
    const result = await anonymous().publicView({ handle: 'alex-to' });
    const rated = result.courses.find((c) => c.courseId === 'c2');
    expect(rated?.ratingCount).toBe(2);
    expect(rated?.ratingAverage).toBe(4.5);
  });

  it('contains no id of a person, and no email', async () => {
    const result = await anonymous().publicView({ handle: 'alex-to' });
    // The photo key is a public media path and is the one place the
    // instructor's key appears (`instructors/<sub>/<uuid>.jpg`).
    const { photoKey, ...rest } = result;
    expect(photoKey).toMatch(/^instructors\//);
    const json = JSON.stringify(rest);
    expect(json).not.toContain('instructor-1');
    expect(json).not.toMatch(/instructorId|userId|email|version|createdAt/);
  });

  describe('not found', () => {
    const causes: [string, () => void][] = [
      ['a malformed handle', () => undefined],
      ['no claim', () => claimGet.mockReturnValue(go({ data: null }))],
      ['no profile', () => profileGet.mockReturnValue(go({ data: null }))],
      ['no courses', () => membershipsQuery.mockReturnValue(go({ data: [] }))],
      [
        'only unpublished courses',
        () =>
          courseGet.mockReturnValue(
            go({ data: [course('c1', 'draft'), course('c2', 'archived')] }),
          ),
      ],
    ];

    it.each(causes)('gives NOT_FOUND for %s', async (name, arrange) => {
      arrange();
      const handle = name === 'a malformed handle' ? 'a--b' : 'alex-to';
      await expect(anonymous().publicView({ handle })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('gives the same error for every cause', async () => {
      const errors: unknown[] = [];
      for (const [name, arrange] of causes) {
        beforeEachReset();
        arrange();
        const handle = name === 'a malformed handle' ? 'a--b' : 'alex-to';
        errors.push(
          await anonymous()
            .publicView({ handle })
            .catch((error: { code: string; message: string }) => ({
              code: error.code,
              message: error.message,
            })),
        );
      }
      expect(new Set(errors.map((e) => JSON.stringify(e))).size).toBe(1);
    });

    it('does not read the table for a malformed handle', async () => {
      await anonymous()
        .publicView({ handle: '--' })
        .catch(() => undefined);
      expect(claimGet).not.toHaveBeenCalled();
    });
  });
});

function beforeEachReset() {
  vi.clearAllMocks();
  claimGet.mockReturnValue(
    go({ data: { handle: 'alex-to', instructorId: 'instructor-1' } }),
  );
  profileGet.mockReturnValue(go({ data: profile }));
  membershipsQuery.mockReturnValue(go({ data: [{ courseId: 'c1' }] }));
  courseGet.mockReturnValue(go({ data: [course('c1', 'published', 'x')] }));
  ratingGet.mockReturnValue(go({ data: [], unprocessed: [] }));
}
