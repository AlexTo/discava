/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  course as analyticsCourse,
  analyticsCourseProcedure,
  quiz as analyticsQuiz,
  courseSummaries,
} from './analytics.js';

const {
  courseInstructorGet,
  courseInstructorQueryByInstructor,
  courseGet,
  readCourseSummaries,
  readCourseAnalytics,
  readQuizAnalytics,
  mockModule,
} = await vi.hoisted(async () => ({
  readCourseSummaries: vi.fn(),
  readCourseAnalytics: vi.fn(),
  readQuizAnalytics: vi.fn(),
  ...(await import('@discava/common-server-utils/trpc-testing')).mockCoreTable({
    course: ['get'],
    courseInstructor: ['get', 'query.byInstructor'],
  }),
}));

vi.mock('@discava/core-table', async (importActual) =>
  mockModule(await importActual(), {
    readCourseSummaries,
    readCourseAnalytics,
    readQuizAnalytics,
  }),
);

// A course-scoped procedure the authorization matrix is written against once;
// each later one is added to PROCEDURES.
const probe = analyticsCourseProcedure.query(() => 'allowed');
const router = t.router({
  courseSummaries,
  course: analyticsCourse,
  quiz: analyticsQuiz,
  probe,
});

const callAs = (sub = 'instructor-1', groups = ['instructor']) =>
  callerFor(router, { sub, groups });

const course = (courseId: string, status = 'published') => ({
  courseId,
  title: `Course ${courseId}`,
  status,
});

// Who teaches what: course-1 by instructor-1 and co-instructor-1; instructor-2
// teaches only course-2.
const TEACHES: Record<string, string[]> = {
  'instructor-1': ['course-1'],
  'co-instructor-1': ['course-1'],
  'instructor-2': ['course-2'],
};

// What readCourseAnalytics answers, unless a test says otherwise.
const analytics = (overrides: Record<string, unknown> = {}) => {
  readCourseAnalytics.mockImplementation(
    async (_table: unknown, _id: string, days: number) => ({
      courseId: 'course-1',
      enrolments: 10,
      completed: 4,
      dropped: 1,
      active: 5,
      activeLearners: 6,
      activated: 4,
      promptAnswered: 2,
      promptDismissed: 1,
      updatedAt: '2026-11-17T09:00:00.000Z',
      lessons: [],
      quizzes: [],
      daily: Array.from({ length: days }, (_, i) => ({
        date: `d${i}`,
        enrolments: 0,
        activeLearners: 0,
        activated: 0,
      })),
      ...overrides,
    }),
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  analytics();
  readQuizAnalytics.mockResolvedValue({
    questions: [],
    scoreBands: [],
    students: 0,
  });
  courseInstructorGet.mockImplementation(
    ({ courseId, instructorId }: Record<string, string>) => ({
      go: async () => ({
        data: TEACHES[instructorId]?.includes(courseId)
          ? { courseId, instructorId }
          : null,
      }),
    }),
  );
});

describe('analyticsCourseProcedure: who may read a course’s analytics', () => {
  const PROCEDURES = [
    {
      name: 'the probe',
      call: (c: ReturnType<typeof callAs>, id: string) =>
        c.probe({ courseId: id }),
    },
    {
      name: 'analytics.course',
      call: (c: ReturnType<typeof callAs>, id: string) =>
        c.course({ courseId: id, days: 30 }).then(() => 'allowed'),
    },
    {
      name: 'analytics.quiz',
      call: (c: ReturnType<typeof callAs>, id: string) =>
        c.quiz({ courseId: id, contentItemId: 'quiz-1' }).then(() => 'allowed'),
    },
  ];

  describe.each(PROCEDURES)('$name', ({ call }) => {
    it.each([
      ['an instructor of the course', 'instructor-1', ['instructor'], true],
      ['a co-instructor', 'co-instructor-1', ['instructor'], true],
      [
        'an instructor of another course',
        'instructor-2',
        ['instructor'],
        false,
      ],
      ['an instructor removed from it', 'instructor-3', ['instructor'], false],
    ])('%s', async (_, sub, groups, allowed) => {
      const result = call(callAs(sub, groups), 'course-1');
      if (allowed) {
        await expect(result).resolves.toBe('allowed');
      } else {
        await expect(result).rejects.toMatchObject({ code: 'NOT_FOUND' });
      }
    });

    it('refuses a student outright', async () => {
      await expect(
        call(callAs('student-1', ['student']), 'course-1'),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('answers a course that does not exist as one taught by someone else', async () => {
      const unknown = await call(callAs('instructor-2'), 'nope').catch(
        (error: TRPCError) => error,
      );
      const other = await call(callAs('instructor-2'), 'course-1').catch(
        (error: TRPCError) => error,
      );
      expect(unknown).toMatchObject({ code: 'NOT_FOUND' });
      expect(unknown.message).toBe(other.message);
    });

    it('rejects a malformed id', async () => {
      await expect(call(callAs(), '')).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    });
  });
});

describe('analytics.courseSummaries', () => {
  const memberships = (...courseIds: string[]) => {
    courseInstructorQueryByInstructor.mockReturnValue({
      go: async () => ({ data: courseIds.map((courseId) => ({ courseId })) }),
    });
  };
  const courses = (...found: (ReturnType<typeof course> | null)[]) => {
    courseGet.mockReturnValue({ go: async () => ({ data: found }) });
  };
  const figures = (
    ...summaries: {
      courseId: string;
      enrolments?: number;
      completed?: number;
      dropped?: number;
      activeLearners?: number;
      updatedAt?: string | null;
    }[]
  ) => {
    readCourseSummaries.mockResolvedValue(
      summaries.map((summary) => ({
        enrolments: 0,
        completed: 0,
        dropped: 0,
        activeLearners: 0,
        updatedAt: null,
        ...summary,
      })),
    );
  };

  it('lists the caller’s courses, whatever their status, in the index’s order', async () => {
    memberships('c3', 'c2', 'c1');
    courses(course('c3', 'draft'), course('c2', 'archived'), course('c1'));
    figures({ courseId: 'c3' }, { courseId: 'c2' }, { courseId: 'c1' });

    const result = await callAs().courseSummaries();

    expect(result.map(({ courseId, status }) => [courseId, status])).toEqual([
      ['c3', 'draft'],
      ['c2', 'archived'],
      ['c1', 'published'],
    ]);
    expect(courseInstructorQueryByInstructor).toHaveBeenCalledWith({
      instructorId: 'instructor-1',
    });
  });

  it('shows no one else’s course', async () => {
    memberships('course-1');
    courses(course('course-1'));
    figures({ courseId: 'course-1' });

    await callAs('instructor-2').courseSummaries();

    expect(courseInstructorQueryByInstructor).toHaveBeenCalledWith({
      instructorId: 'instructor-2',
    });
  });

  it('answers an empty list, reading nothing more, for an instructor with no courses', async () => {
    memberships();
    await expect(callAs().courseSummaries()).resolves.toEqual([]);
    expect(courseGet).not.toHaveBeenCalled();
    expect(readCourseSummaries).not.toHaveBeenCalled();
  });

  it('drops a course deleted after its membership was written', async () => {
    memberships('c1', 'gone');
    courses(course('c1'), null);
    figures({ courseId: 'c1' });

    const result = await callAs().courseSummaries();

    expect(result.map(({ courseId }) => courseId)).toEqual(['c1']);
    expect(readCourseSummaries).toHaveBeenCalledWith(expect.anything(), ['c1']);
  });

  it('gives the figures of each course', async () => {
    memberships('c1');
    courses(course('c1'));
    figures({
      courseId: 'c1',
      enrolments: 12,
      completed: 3,
      dropped: 2,
      activeLearners: 5,
      updatedAt: '2026-11-17T08:00:00.000Z',
    });

    const [summary] = await callAs().courseSummaries();

    expect(summary).toEqual({
      courseId: 'c1',
      title: 'Course c1',
      status: 'published',
      enrolments: 12,
      activeThisWeek: 5,
      completionRate: 30,
      updatedAt: '2026-11-17T08:00:00.000Z',
    });
  });

  it.each([
    // completed, enrolments, dropped, expected
    [1, 3, 0, 33],
    [2, 3, 0, 66],
    [3, 3, 0, 100],
    [1, 4, 2, 50],
    [0, 5, 0, 0],
  ])(
    'rounds the completion rate down: %i of %i enrolled, %i dropped is %i%%',
    async (completed, enrolments, dropped, expected) => {
      memberships('c1');
      courses(course('c1'));
      figures({ courseId: 'c1', enrolments, completed, dropped });
      const [summary] = await callAs().courseSummaries();
      expect(summary.completionRate).toBe(expected);
    },
  );

  it.each([
    [0, 0],
    [3, 3],
  ])(
    'has no completion rate when %i enrolled and %i dropped leave nobody',
    async (enrolments, dropped) => {
      memberships('c1');
      courses(course('c1'));
      figures({ courseId: 'c1', enrolments, dropped });
      const [summary] = await callAs().courseSummaries();
      expect(summary.completionRate).toBeNull();
    },
  );

  it('shows zeros and no update time for a course nothing has happened in', async () => {
    memberships('c1');
    courses(course('c1'));
    figures();

    const [summary] = await callAs().courseSummaries();

    expect(summary).toMatchObject({
      enrolments: 0,
      activeThisWeek: 0,
      completionRate: null,
      updatedAt: null,
    });
  });

  it('lists the lessons with their started, completed and share', async () => {
    analytics({
      lessons: [
        {
          lessonId: 'l1',
          moduleId: 'm1',
          moduleTitle: 'Basics',
          title: 'Intro',
          inProgress: 1,
          completed: 3,
          started: 4,
          completionShare: 75,
        },
        {
          lessonId: 'l2',
          moduleId: 'm1',
          moduleTitle: 'Basics',
          title: 'Next',
          inProgress: 0,
          completed: 0,
          started: 0,
          completionShare: null,
        },
      ],
    });
    const result = await callAs().course({ courseId: 'course-1', days: 30 });

    expect(result.lessons).toEqual([
      {
        lessonId: 'l1',
        moduleId: 'm1',
        title: 'Intro',
        started: 4,
        completed: 3,
        completionShare: 75,
      },
      {
        lessonId: 'l2',
        moduleId: 'm1',
        title: 'Next',
        started: 0,
        completed: 0,
        completionShare: null,
      },
    ]);
  });

  it('contains no student identifier', async () => {
    memberships('c1');
    courses(course('c1'));
    figures({ courseId: 'c1', enrolments: 1, completed: 1 });

    const result = await callAs().courseSummaries();

    expect(Object.keys(result[0]).sort()).toEqual([
      'activeThisWeek',
      'completionRate',
      'courseId',
      'enrolments',
      'status',
      'title',
      'updatedAt',
    ]);
  });

  it('refuses a caller outside the instructor group', async () => {
    await expect(
      callAs('student-1', ['student']).courseSummaries(),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorQueryByInstructor).not.toHaveBeenCalled();
  });
});

describe('analytics.course', () => {
  it('gives the totals, with the completion rate and this week', async () => {
    const result = await callAs().course({ courseId: 'course-1', days: 30 });

    expect(result.totals).toEqual({
      enrolments: 10,
      active: 5,
      completed: 4,
      dropped: 1,
      completionRate: 44,
      activeThisWeek: 6,
      activated: 4,
      activationRate: 40,
      promptAnswered: 2,
      promptDismissed: 1,
      updatedAt: '2026-11-17T09:00:00.000Z',
    });
    expect(result.lessons).toEqual([]);
    expect(result.quizzes).toEqual([]);
  });

  it('lists the course’s shown quizzes', async () => {
    analytics({
      quizzes: [
        {
          contentItemId: 'quiz-1',
          lessonId: 'l1',
          title: 'Checkpoint',
          students: 7,
        },
      ],
    });
    const result = await callAs().course({ courseId: 'course-1', days: 30 });
    expect(result.quizzes).toEqual([
      {
        contentItemId: 'quiz-1',
        lessonId: 'l1',
        title: 'Checkpoint',
        students: 7,
      },
    ]);
  });

  it.each([30, 90])('gives %i daily entries', async (days) => {
    const result = await callAs().course({ courseId: 'course-1', days });

    expect(result.daily).toHaveLength(days);
    expect(readCourseAnalytics).toHaveBeenCalledWith(
      expect.anything(),
      'course-1',
      days,
    );
  });

  it('defaults to 90 days', async () => {
    const result = await callAs().course({ courseId: 'course-1' });
    expect(result.daily).toHaveLength(90);
  });

  it.each([7, 60, 0, '30'])('rejects %s days', async (days) => {
    await expect(
      callAs().course({ courseId: 'course-1', days: days as never }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(readCourseAnalytics).not.toHaveBeenCalled();
  });

  it('has no completion rate when nobody is left enrolled', async () => {
    analytics({
      enrolments: 2,
      dropped: 2,
      completed: 0,
      active: 0,
      activated: 0,
    });
    const result = await callAs().course({ courseId: 'course-1', days: 30 });
    expect(result.totals.completionRate).toBeNull();
  });

  it('rounds the activation rate down: 1 of 3 is 33', async () => {
    analytics({ enrolments: 3, activated: 1 });
    const result = await callAs().course({ courseId: 'course-1', days: 30 });
    expect(result.totals.activated).toBe(1);
    expect(result.totals.activationRate).toBe(33);
  });

  it('has no activation rate with no enrolments', async () => {
    analytics({ enrolments: 0, activated: 0, completed: 0, dropped: 0 });
    const result = await callAs().course({ courseId: 'course-1', days: 30 });
    expect(result.totals.activationRate).toBeNull();
  });

  it('carries each day’s activated count', async () => {
    analytics({
      daily: [
        { date: '2026-11-17', enrolments: 3, activeLearners: 1, activated: 2 },
      ],
    });
    const result = await callAs().course({ courseId: 'course-1', days: 30 });
    expect(result.daily).toEqual([
      { date: '2026-11-17', enrolments: 3, activeLearners: 1, activated: 2 },
    ]);
  });

  it('reads nothing for a course the caller does not teach', async () => {
    await expect(
      callAs('instructor-2').course({ courseId: 'course-1', days: 30 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(readCourseAnalytics).not.toHaveBeenCalled();
  });

  it('lists the lessons with their started, completed and share', async () => {
    analytics({
      lessons: [
        {
          lessonId: 'l1',
          moduleId: 'm1',
          moduleTitle: 'Basics',
          title: 'Intro',
          inProgress: 1,
          completed: 3,
          started: 4,
          completionShare: 75,
        },
        {
          lessonId: 'l2',
          moduleId: 'm1',
          moduleTitle: 'Basics',
          title: 'Next',
          inProgress: 0,
          completed: 0,
          started: 0,
          completionShare: null,
        },
      ],
    });
    const result = await callAs().course({ courseId: 'course-1', days: 30 });

    expect(result.lessons).toEqual([
      {
        lessonId: 'l1',
        moduleId: 'm1',
        title: 'Intro',
        started: 4,
        completed: 3,
        completionShare: 75,
      },
      {
        lessonId: 'l2',
        moduleId: 'm1',
        title: 'Next',
        started: 0,
        completed: 0,
        completionShare: null,
      },
    ]);
  });

  it('contains no student identifier', async () => {
    const result = await callAs().course({ courseId: 'course-1', days: 30 });
    expect(Object.keys(result).sort()).toEqual([
      'daily',
      'lessons',
      'quizzes',
      'totals',
    ]);
    expect(Object.keys(result.daily[0]).sort()).toEqual([
      'activated',
      'activeLearners',
      'date',
      'enrolments',
    ]);
  });
});

describe('analytics.quiz', () => {
  const figures = (overrides: Record<string, unknown> = {}) => {
    readQuizAnalytics.mockResolvedValue({
      questions: [
        {
          questionId: 'q2',
          text: 'Second',
          attempts: 8,
          misses: 6,
          missRate: 75,
          ranked: true,
        },
        {
          questionId: 'q1',
          text: 'First',
          attempts: 2,
          misses: 1,
          missRate: 50,
          ranked: false,
        },
      ],
      scoreBands: Array.from({ length: 10 }, (_, band) => ({
        from: band * 10,
        to: band === 9 ? 100 : band * 10 + 9,
        students: band === 8 ? 4 : 0,
      })),
      students: 4,
      ...overrides,
    });
  };
  beforeEach(figures);

  it('gives the ranking and the ten score bands', async () => {
    const result = await callAs().quiz({
      courseId: 'course-1',
      contentItemId: 'quiz-1',
    });

    expect(readQuizAnalytics).toHaveBeenCalledWith(
      expect.anything(),
      'course-1',
      'quiz-1',
    );
    expect(result.questions.map(({ questionId }) => questionId)).toEqual([
      'q2',
      'q1',
    ]);
    expect(result.questions[0]).toEqual({
      questionId: 'q2',
      text: 'Second',
      attempts: 8,
      misses: 6,
      missRate: 75,
      ranked: true,
    });
    expect(result.scoreBands).toHaveLength(10);
    expect(result.scoreBands[8]).toEqual({ from: 80, to: 89, students: 4 });
    expect(result.students).toBe(4);
  });

  it('answers NOT_FOUND for a quiz that is not the course’s or does not exist', async () => {
    readQuizAnalytics.mockResolvedValue(undefined);
    await expect(
      callAs().quiz({ courseId: 'course-1', contentItemId: 'other' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reads nothing for a course the caller does not teach', async () => {
    await expect(
      callAs('instructor-2').quiz({
        courseId: 'course-1',
        contentItemId: 'quiz-1',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(readQuizAnalytics).not.toHaveBeenCalled();
  });

  it('rejects a malformed quiz id', async () => {
    await expect(
      callAs().quiz({ courseId: 'course-1', contentItemId: '' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('contains no student identifier', async () => {
    const result = await callAs().quiz({
      courseId: 'course-1',
      contentItemId: 'quiz-1',
    });
    expect(Object.keys(result).sort()).toEqual([
      'questions',
      'scoreBands',
      'students',
    ]);
    expect(Object.keys(result.questions[0]).sort()).toEqual(
      ['attempts', 'misses', 'missRate', 'questionId', 'ranked', 'text'].sort(),
    );
  });
});
