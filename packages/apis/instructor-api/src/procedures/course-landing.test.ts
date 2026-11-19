/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { InvalidRequestError } from '@discava/core-table';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { updateCourseLanding } from './course-landing.js';

const { courseGet, courseInstructorGet, courseLandingSet, transactionWrite } =
  vi.hoisted(() => ({
    courseGet: vi.fn(),
    courseInstructorGet: vi.fn(),
    courseLandingSet: vi.fn(),
    transactionWrite: vi.fn(),
  }));

// The helper's own rules (trimming, bounds, the items it builds) are tested in
// core-table; here it is replaced to check what the procedure hands it, that
// its items are committed in one transaction, and how errors are mapped.
vi.mock('@discava/core-table', async (importActual) => {
  const actual = await importActual<typeof import('@discava/core-table')>();
  return {
    ...actual,
    courseLandingWrites: { set: courseLandingSet },
    createCoreTableService: vi.fn(async () => ({
      entities: {
        course: { get: courseGet },
        courseInstructor: { get: courseInstructorGet },
      },
      transaction: { write: transactionWrite },
    })),
  };
});

const router = t.router({ updateCourseLanding });

const callAs = (groups: string[] = ['instructor']) =>
  callerFor(router, { sub: 'instructor-1', groups });

const course = {
  courseId: 'course-1',
  title: 'Course',
  status: 'draft',
  certificatesEnabled: true,
  priceAmount: 0,
  priceCurrency: 'USD',
  learningOutcomes: ['Build'],
  createdAt: 'a',
  updatedAt: 'b',
};

const input = {
  courseId: 'course-1',
  learningOutcomes: ['Build'],
  requirements: [],
};

describe('course.updateLanding', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    courseInstructorGet.mockReturnValue({
      go: async () => ({ data: { courseId: 'course-1' } }),
    });
    courseGet.mockReturnValue({ go: async () => ({ data: course }) });
    courseLandingSet.mockResolvedValue(['course-item', 'instructor-item']);
    transactionWrite.mockReturnValue({
      go: async () => ({ canceled: false, data: [] }),
    });
  });

  it.each(['draft', 'published', 'archived'])(
    'saves both lists in a %s course, in one transaction',
    async (status) => {
      courseGet.mockReturnValue({
        go: async () => ({ data: { ...course, status } }),
      });

      await expect(callAs().updateCourseLanding(input)).resolves.toMatchObject({
        courseId: 'course-1',
        learningOutcomes: ['Build'],
      });

      expect(courseLandingSet).toHaveBeenCalledWith(expect.anything(), {
        ...input,
        now: expect.any(Date),
      });
      expect(transactionWrite).toHaveBeenCalledTimes(1);
      const build = transactionWrite.mock.calls[0][0] as () => unknown[];
      expect(build()).toEqual(['course-item', 'instructor-item']);
    },
  );

  it('passes [] through, so the list is cleared', async () => {
    await callAs().updateCourseLanding({
      courseId: 'course-1',
      learningOutcomes: [],
      requirements: [],
    });
    expect(courseLandingSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ learningOutcomes: [], requirements: [] }),
    );
  });

  it('refuses a caller who does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({ go: async () => ({ data: null }) });
    await expect(callAs().updateCourseLanding(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('refuses a caller outside the instructor group', async () => {
    await expect(callAs([]).updateCourseLanding(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(courseLandingSet).not.toHaveBeenCalled();
  });

  describe('validation, before anything is read', () => {
    it.each([
      [
        'an 11th outcome',
        { learningOutcomes: Array.from({ length: 11 }, () => 'x') },
        /Learning outcomes can have at most 10 items/,
      ],
      [
        'an 11th requirement',
        { requirements: Array.from({ length: 11 }, () => 'x') },
        /Requirements can have at most 10 items/,
      ],
      [
        'a whitespace-only outcome, naming its position',
        { learningOutcomes: ['ok', '   '] },
        /Learning outcomes item 2 must be 1 to 160 characters/,
      ],
      [
        'a 161-character requirement, naming its position',
        { requirements: ['a'.repeat(161)] },
        /Requirements item 1 must be 1 to 160 characters/,
      ],
    ])('refuses %s', async (_, lists, message) => {
      await expect(
        callAs().updateCourseLanding({ ...input, ...lists }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringMatching(message),
      });
      expect(courseInstructorGet).not.toHaveBeenCalled();
      expect(courseLandingSet).not.toHaveBeenCalled();
    });

    it('counts a padded item by its trimmed length', async () => {
      await expect(
        callAs().updateCourseLanding({
          ...input,
          requirements: [` ${'a'.repeat(160)} `],
        }),
      ).resolves.toBeDefined();
    });
  });

  it('maps the helper refusing a list to BAD_REQUEST', async () => {
    courseLandingSet.mockRejectedValue(new InvalidRequestError('Too many'));
    await expect(callAs().updateCourseLanding(input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Too many',
    });
  });

  it('maps a course that vanished to NOT_FOUND, and any other cancel to CONFLICT', async () => {
    transactionWrite.mockReturnValue({
      go: async () => ({
        canceled: true,
        data: [{ code: 'ConditionalCheckFailed' }, { code: 'None' }],
      }),
    });
    await expect(callAs().updateCourseLanding(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    transactionWrite.mockReturnValue({
      go: async () => ({
        canceled: true,
        data: [{ code: 'None' }, { code: 'TransactionConflict' }],
      }),
    });
    await expect(callAs().updateCourseLanding(input)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});
