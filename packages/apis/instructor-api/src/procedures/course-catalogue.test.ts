/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { InvalidRequestError, NotFoundError } from '@discava/core-table';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  listActiveCategories,
  updateCourseCatalogue,
} from './course-catalogue.js';

const {
  courseGet,
  courseInstructorGet,
  categoryQueryPrimary,
  courseCatalogueWrites,
} = vi.hoisted(() => ({
  courseGet: vi.fn(),
  courseInstructorGet: vi.fn(),
  categoryQueryPrimary: vi.fn(),
  courseCatalogueWrites: vi.fn(),
}));

// The helper's own rules (normalising, ranges, the category check) are tested
// in core-table; here it is replaced to check what the procedure hands it and
// how it maps its errors.
vi.mock('@discava/core-table', async (importActual) => ({
  ...(await importActual<typeof import('@discava/core-table')>()),
  courseCatalogueWrites,
  createCoreTableService: vi.fn(async () => ({
    entities: {
      course: { get: courseGet },
      courseInstructor: { get: courseInstructorGet },
      category: { query: { primary: categoryQueryPrimary } },
    },
  })),
}));

const router = t.router({ updateCourseCatalogue, listActiveCategories });
const caller = t.createCallerFactory(router);

const callAs = (groups: string[] = ['instructor']) =>
  caller({
    event: {
      requestContext: {
        authorizer: {
          claims: { sub: 'instructor-1', 'cognito:groups': groups },
        },
      },
    } as unknown as APIGatewayProxyEvent,
    context: {} as any,
    info: {} as any,
  });

const course = {
  courseId: 'course-1',
  title: 'Course',
  status: 'draft',
  certificatesEnabled: true,
  createdAt: 'a',
  updatedAt: 'b',
};

describe('course.updateCatalogue', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    courseInstructorGet.mockReturnValue({
      go: async () => ({ data: { courseId: 'course-1' } }),
    });
    courseGet.mockReturnValue({ go: async () => ({ data: course }) });
    courseCatalogueWrites.mockResolvedValue(undefined);
  });

  it('refuses a caller who does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({ go: async () => ({ data: null }) });
    await expect(
      callAs().updateCourseCatalogue({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseCatalogueWrites).not.toHaveBeenCalled();
  });

  it('refuses a caller outside the instructor group', async () => {
    await expect(
      callAs([]).updateCourseCatalogue({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseCatalogueWrites).not.toHaveBeenCalled();
  });

  it('sets every field and returns the course', async () => {
    const input = {
      courseId: 'course-1',
      categoryId: 'cat-1',
      tags: [' Data  Science '],
      level: 'beginner' as const,
      language: 'en' as const,
      durationHours: 12,
    };
    await expect(callAs().updateCourseCatalogue(input)).resolves.toMatchObject({
      courseId: 'course-1',
    });
    expect(courseCatalogueWrites).toHaveBeenCalledWith(
      expect.anything(),
      input,
    );
  });

  it('passes no fields when all are omitted, so they are cleared', async () => {
    await callAs().updateCourseCatalogue({ courseId: 'course-1' });
    expect(courseCatalogueWrites).toHaveBeenCalledWith(expect.anything(), {
      courseId: 'course-1',
    });
  });

  it('rejects an unknown level or language', async () => {
    await expect(
      callAs().updateCourseCatalogue({
        courseId: 'course-1',
        level: 'expert' as never,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      callAs().updateCourseCatalogue({
        courseId: 'course-1',
        language: 'xx' as never,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(courseCatalogueWrites).not.toHaveBeenCalled();
  });

  it('maps the helper refusing a value or category to BAD_REQUEST', async () => {
    courseCatalogueWrites.mockRejectedValue(
      new InvalidRequestError('Choose an active category'),
    );
    await expect(
      callAs().updateCourseCatalogue({
        courseId: 'course-1',
        categoryId: 'archived',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Choose an active category',
    });
  });

  it('maps a course that vanished to NOT_FOUND', async () => {
    courseCatalogueWrites.mockRejectedValue(new NotFoundError());
    await expect(
      callAs().updateCourseCatalogue({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('category.listActive', () => {
  beforeEach(() => vi.resetAllMocks());

  it('lists only active categories, by name', async () => {
    categoryQueryPrimary.mockReturnValue({
      go: async () => ({
        data: [
          { categoryId: 'b', name: 'Zoology', status: 'active' },
          { categoryId: 'c', name: 'Old', status: 'archived' },
          { categoryId: 'a', name: 'Art', status: 'active' },
        ],
      }),
    });
    await expect(callAs().listActiveCategories()).resolves.toEqual([
      { id: 'a', name: 'Art' },
      { id: 'b', name: 'Zoology' },
    ]);
  });
});
