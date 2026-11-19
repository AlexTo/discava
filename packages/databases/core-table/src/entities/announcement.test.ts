/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createAnnouncementEntity } from './announcement.js';
import { createCourseInstructorEntity } from './course-instructor.js';
import { createEnrolmentEntity } from './enrolment.js';

// The requests ElectroDB would send, checked without a table.

let announcement: Awaited<ReturnType<typeof createAnnouncementEntity>>;
let enrolment: Awaited<ReturnType<typeof createEnrolmentEntity>>;
let courseInstructor: Awaited<ReturnType<typeof createCourseInstructorEntity>>;
beforeAll(async () => {
  [announcement, enrolment, courseInstructor] = await Promise.all([
    createAnnouncementEntity(),
    createEnrolmentEntity(),
    createCourseInstructorEntity(),
  ]);
});

const record = {
  courseId: 'course-1',
  announcementId: '01920000-0000-7000-8000-000000000001',
  title: 'Welcome',
  body: '{"type":"doc","content":[{"type":"paragraph"}]}',
  authorId: 'user-1',
  createdAt: '2026-11-15T00:00:00.000Z',
};

describe('announcement', () => {
  it('starts at version 1 with no editedAt', () => {
    const { Item } = announcement.create(record).params();

    expect(Item).toMatchObject({ version: 1, createdAt: record.createdAt });
    expect(Item).not.toHaveProperty('editedAt');
  });

  it.each(['title', 'body', 'authorId', 'createdAt'])(
    'is refused without its %s',
    (field) => {
      const { [field as keyof typeof record]: _, ...rest } = record;
      expect(() => announcement.create(rest as never).params()).toThrow();
    },
  );

  it('cannot change its createdAt', () => {
    expect(() =>
      announcement
        .patch({
          courseId: record.courseId,
          announcementId: record.announcementId,
        })
        .set({ createdAt: '2026-11-16T00:00:00.000Z' } as never)
        .params(),
    ).toThrow();
  });

  it('queries a course newest first with a descending query', () => {
    const built = announcement.query
      .primary({ courseId: record.courseId })
      .params({ order: 'desc' }) as { ScanIndexForward?: boolean };

    expect(built.ScanIndexForward).toBe(false);
  });

  it('keeps its keys in the course partition without colliding with others', () => {
    const { Item: a } = announcement.create(record).params() as {
      Item: { pk: string; sk: string };
    };
    const { Item: e } = enrolment
      .create({
        courseId: record.courseId,
        userId: 'user-1',
        status: 'active',
      } as never)
      .params() as { Item: { pk: string; sk: string } };
    const { Item: i } = courseInstructor
      .create({
        courseId: record.courseId,
        instructorId: 'user-1',
        courseUpdatedAt: record.createdAt,
      })
      .params() as { Item: { pk: string; sk: string } };

    expect(a.pk).toBe(i.pk);
    expect(a.sk).not.toBe(e.sk);
    expect(a.sk).not.toBe(i.sk);
    expect(a.sk).toContain(record.announcementId);
  });
});
