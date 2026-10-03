/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  createContentItemQuiz,
  updateContentItemQuiz,
} from './content-item-quiz.js';

const {
  transactionWrite,
  transactionGo,
  moduleGet,
  courseGet,
  courseInstructorGet,
  lessonGet,
  contentItemQueryPrimary,
  contentItemCreate,
  contentItemGet,
  contentItemPatch,
  contentItemPatchSet,
  contentItemPatchWhere,
} = vi.hoisted(() => ({
  transactionWrite: vi.fn(),
  transactionGo: vi.fn(),
  moduleGet: vi.fn(),
  courseGet: vi.fn(),
  courseInstructorGet: vi.fn(),
  lessonGet: vi.fn(),
  contentItemQueryPrimary: vi.fn(),
  contentItemCreate: vi.fn(),
  contentItemGet: vi.fn(),
  contentItemPatch: vi.fn(),
  contentItemPatchSet: vi.fn(),
  contentItemPatchWhere: vi.fn(),
}));

vi.mock('@discava/core-table', () => ({
  createCoreTableService: vi.fn(async () => ({
    entities: {
      course: { get: courseGet },
      courseInstructor: {
        get: courseInstructorGet,
      },
      module: {
        get: moduleGet,
      },
      lesson: {
        get: lessonGet,
      },
      contentItem: {
        query: {
          primary: contentItemQueryPrimary,
        },
        create: contentItemCreate,
        get: contentItemGet,
        patch: contentItemPatch,
      },
    },
    transaction: {
      write: transactionWrite,
    },
  })),
}));

const router = t.router({
  createContentItemQuiz,
  updateContentItemQuiz,
});
const caller = t.createCallerFactory(router);

const INSTRUCTOR_SUB = 'instructor-1';
const COURSE_ID = 'course-1';
const MODULE_ID = 'module-1';
const LESSON_ID = 'lesson-1';
const CONTENT_ITEM_ID = 'content-item-1';

const buildEvent = (groups: string[]): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: { claims: { sub: INSTRUCTOR_SUB, 'cognito:groups': groups } },
    },
  }) as unknown as APIGatewayProxyEvent;

const callAs = (groups: string[] = ['instructor']) =>
  caller({ event: buildEvent(groups), context: {} as any, info: {} as any });

const lesson = {
  lessonId: LESSON_ID,
  moduleId: MODULE_ID,
  courseId: COURSE_ID,
  title: 'Welcome',
  order: 1,
  visibility: 'visible' as const,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const contentItem = {
  contentItemId: CONTENT_ITEM_ID,
  lessonId: LESSON_ID,
  moduleId: MODULE_ID,
  courseId: COURSE_ID,
  type: 'video' as const,
  status: 'ready' as const,
  title: 'Intro video',
  s3Key: `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/${CONTENT_ITEM_ID}.mp4`,
  mimeType: 'video/mp4',
  order: 1,
  visibility: 'visible' as const,
  studentActivityCount: 0,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

const questions = [
  {
    questionId: 'q1',
    kind: 'single' as const,
    prompt: doc('Which service runs containers without servers?'),
    options: [
      { optionId: 'a', text: 'EC2' },
      { optionId: 'b', text: 'Fargate' },
    ],
  },
  {
    questionId: 'q2',
    kind: 'multiple' as const,
    prompt: doc('Which are serverless?'),
    options: [
      { optionId: 'a', text: 'Lambda' },
      { optionId: 'b', text: 'EC2' },
      { optionId: 'c', text: 'Fargate' },
    ],
  },
];

const answerKey = {
  q1: { correctOptionIds: ['b'], explanation: doc('No servers to manage') },
  q2: { correctOptionIds: ['a', 'c'] },
};

const settings = {
  passMarkPercent: 80,
  attemptsAllowed: 3,
  shuffleOptions: false,
  revealAnswers: 'after_each_attempt' as const,
};

const quiz = { questions, answerKey, settings };

const quizContentItem = {
  contentItemId: CONTENT_ITEM_ID,
  lessonId: LESSON_ID,
  moduleId: MODULE_ID,
  courseId: COURSE_ID,
  type: 'quiz' as const,
  status: 'ready' as const,
  title: 'Module check',
  ...quiz,
  quizVersion: 1,
  questionsHash: 'hash',
  order: 1,
  visibility: 'visible' as const,
  studentActivityCount: 0,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();

  courseGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: { status: 'draft' } }),
  });

  courseInstructorGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({
      data: { courseId: COURSE_ID, instructorId: INSTRUCTOR_SUB },
    }),
  });
  // The module above the lesson; not archived unless a test says so.
  moduleGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({
      data: { moduleId: MODULE_ID, visibility: 'visible' },
    }),
  });
  lessonGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: lesson }),
  });
  contentItemQueryPrimary.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: [] }),
  });
  // Creates and edits are written in a transaction behind checks that the
  // module and lesson are still active, so their chains end in .commit();
  // the result is read back with get.
  contentItemCreate.mockReturnValue({ commit: () => ({}) });
  contentItemGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: quizContentItem }),
  });
  contentItemPatch.mockReturnValue({ set: contentItemPatchSet });
  contentItemPatchSet.mockReturnValue({ where: contentItemPatchWhere });
  contentItemPatchWhere.mockReturnValue({ commit: () => ({}) });
  const ancestorCheck = () => ({
    where: () => ({ commit: () => ({}) }),
  });
  transactionWrite.mockImplementation((fn) => {
    fn({
      module: { check: ancestorCheck },
      lesson: { check: ancestorCheck },
      contentItem: { create: contentItemCreate, patch: contentItemPatch },
    });
    return { go: transactionGo };
  });
  transactionGo.mockResolvedValue({ canceled: false, data: [] });
});

describe('createContentItemQuiz', () => {
  const input = {
    courseId: COURSE_ID,
    moduleId: MODULE_ID,
    lessonId: LESSON_ID,
    title: 'Module check',
    ...quiz,
  };

  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).createContentItemQuiz(input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
  });

  it('rejects instructors who do not teach the course', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(callAs().createContentItemQuiz(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(contentItemCreate).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the lesson does not exist', async () => {
    lessonGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(callAs().createContentItemQuiz(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(contentItemCreate).not.toHaveBeenCalled();
  });

  it('refuses to add a quiz under an archived lesson', async () => {
    lessonGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { ...lesson, archivedAt: '2024-02-01T00:00:00.000Z' },
      }),
    });

    await expect(callAs().createContentItemQuiz(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('refuses to add a quiz under an archived module', async () => {
    moduleGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { moduleId: MODULE_ID, archivedAt: '2024-02-01T00:00:00.000Z' },
      }),
    });

    await expect(callAs().createContentItemQuiz(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('writes the quiz at version 1 with a hash of its questions, appended to the lesson', async () => {
    contentItemQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [{ order: 3 }] }),
    });

    const result = await callAs().createContentItemQuiz(input);

    expect(contentItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'quiz',
        contentItemId: expect.any(String),
        questions,
        answerKey,
        settings,
        quizVersion: 1,
        questionsHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        order: 4,
        visibility: 'visible',
      }),
    );
    expect(result).toEqual(quizContentItem);
  });

  it('starts hidden in a published course', async () => {
    courseGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: { status: 'published' } }),
    });

    await callAs().createContentItemQuiz(input);

    expect(contentItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'hidden' }),
    );
  });

  it('reports CONFLICT when an ancestor was archived after the checks', async () => {
    transactionGo.mockResolvedValue({
      canceled: true,
      data: [{ code: 'ConditionalCheckFailed' }, {}, {}],
    });

    await expect(callAs().createContentItemQuiz(input)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  describe('validation', () => {
    const rejects = async (override: Record<string, unknown>) => {
      await expect(
        callAs().createContentItemQuiz({ ...input, ...override } as any),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(courseInstructorGet).not.toHaveBeenCalled();
      expect(contentItemCreate).not.toHaveBeenCalled();
    };
    const withQuestion = (index: number, patch: Record<string, unknown>) =>
      questions.map((q, i) => (i === index ? { ...q, ...patch } : q));

    it('requires at least one question', async () => {
      await rejects({ questions: [], answerKey: {} });
    });

    it('requires at least 2 options per question', async () => {
      await rejects({
        questions: withQuestion(0, { options: [questions[0].options[0]] }),
      });
    });

    it('requires exactly 1 correct option for a single choice question', async () => {
      await rejects({
        answerKey: { ...answerKey, q1: { correctOptionIds: ['a', 'b'] } },
      });
      await rejects({
        answerKey: { ...answerKey, q1: { correctOptionIds: [] } },
      });
    });

    it('requires at least 1 correct option for a multiple choice question', async () => {
      await rejects({
        answerKey: { ...answerKey, q2: { correctOptionIds: [] } },
      });
    });

    it('accepts several correct options for a multiple choice question', async () => {
      await callAs().createContentItemQuiz({
        ...input,
        answerKey: { ...answerKey, q2: { correctOptionIds: ['a', 'b', 'c'] } },
      });
      expect(contentItemCreate).toHaveBeenCalled();
    });

    it('rejects a correct option that is not one of the question options', async () => {
      await rejects({
        answerKey: { ...answerKey, q1: { correctOptionIds: ['z'] } },
      });
    });

    it('rejects a question without an answer key entry', async () => {
      await rejects({ answerKey: { q1: answerKey.q1 } });
    });

    it('rejects an answer key entry for an unknown question', async () => {
      await rejects({
        answerKey: { ...answerKey, q9: { correctOptionIds: ['a'] } },
      });
    });

    it('rejects duplicate question ids and duplicate option ids', async () => {
      await rejects({
        questions: [questions[0], { ...questions[1], questionId: 'q1' }],
      });
      await rejects({
        questions: withQuestion(0, {
          options: [
            { optionId: 'a', text: 'EC2' },
            { optionId: 'a', text: 'Fargate' },
          ],
        }),
      });
    });

    it('rejects a prompt or explanation that is not a Tiptap document', async () => {
      await rejects({ questions: withQuestion(0, { prompt: 'plain text' }) });
      await rejects({
        questions: withQuestion(0, {
          prompt: JSON.stringify({ type: 'doc', content: 'oops' }),
        }),
      });
      await rejects({
        questions: withQuestion(0, {
          prompt: JSON.stringify({
            type: 'doc',
            content: [{ type: 'notARealNode' }],
          }),
        }),
      });
      await rejects({
        questions: withQuestion(0, { prompt: JSON.stringify({ a: 1 }) }),
      });
      await rejects({
        answerKey: {
          ...answerKey,
          q1: { correctOptionIds: ['b'], explanation: '{not json' },
        },
      });
    });

    it('rejects out of range settings', async () => {
      await rejects({ settings: { ...settings, passMarkPercent: 101 } });
      await rejects({ settings: { ...settings, attemptsAllowed: 0 } });
      await rejects({ settings: { ...settings, revealAnswers: 'always' } });
    });

    it('allows unlimited attempts', async () => {
      await callAs().createContentItemQuiz({
        ...input,
        settings: { ...settings, attemptsAllowed: null },
      });
      expect(contentItemCreate).toHaveBeenCalled();
    });
  });
});

describe('updateContentItemQuiz', () => {
  const input = {
    courseId: COURSE_ID,
    moduleId: MODULE_ID,
    lessonId: LESSON_ID,
    contentItemId: CONTENT_ITEM_ID,
    quizVersion: 1,
    ...quiz,
  };

  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).updateContentItemQuiz(input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
  });

  it('rejects instructors who do not teach the course', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(callAs().updateContentItemQuiz(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(contentItemPatch).not.toHaveBeenCalled();
  });

  it('validates the quiz like create does', async () => {
    await expect(
      callAs().updateContentItemQuiz({
        ...input,
        answerKey: { ...answerKey, q1: { correctOptionIds: ['a', 'b'] } },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(contentItemPatch).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the content item does not exist', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(callAs().updateContentItemQuiz(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(contentItemPatch).not.toHaveBeenCalled();
  });

  it('throws BAD_REQUEST when the existing content item is not a quiz', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { ...quizContentItem, type: 'text', body: doc('hi') },
      }),
    });

    await expect(callAs().updateContentItemQuiz(input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(contentItemPatch).not.toHaveBeenCalled();
  });

  it('refuses to edit an archived quiz', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { ...quizContentItem, archivedAt: '2024-02-01T00:00:00.000Z' },
      }),
    });

    await expect(callAs().updateContentItemQuiz(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('refuses to edit a quiz under an archived lesson', async () => {
    lessonGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { ...lesson, archivedAt: '2024-02-01T00:00:00.000Z' },
      }),
    });

    await expect(callAs().updateContentItemQuiz(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('replaces questions, key and settings, bumps the version and rehashes the questions', async () => {
    const edited = [
      { ...questions[0], prompt: doc('A different question?') },
      questions[1],
    ];

    await callAs().updateContentItemQuiz({
      ...input,
      title: 'Renamed',
      questions: edited,
    });

    expect(contentItemPatchSet).toHaveBeenCalledWith({
      title: 'Renamed',
      questions: edited,
      answerKey,
      settings,
      quizVersion: 2,
      questionsHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const hashOf = (qs: unknown) =>
      contentItemPatchSet.mock.calls.at(-1)?.[0].questionsHash;
    const editedHash = hashOf(edited);

    await callAs().updateContentItemQuiz(input);
    expect(hashOf(questions)).not.toBe(editedHash);
  });

  it('keeps the same hash when only the answer key or settings change', async () => {
    await callAs().updateContentItemQuiz(input);
    const first = contentItemPatchSet.mock.calls.at(-1)?.[0].questionsHash;

    await callAs().updateContentItemQuiz({
      ...input,
      answerKey: { ...answerKey, q2: { correctOptionIds: ['a'] } },
      settings: { ...settings, passMarkPercent: 50 },
    });

    expect(contentItemPatchSet.mock.calls.at(-1)?.[0].questionsHash).toBe(
      first,
    );
  });

  it('conditions the write on the quiz not being archived and still at the version it read', async () => {
    await callAs().updateContentItemQuiz(input);

    const condition = contentItemPatchWhere.mock.calls[0][0] as (
      attr: Record<string, string>,
      op: Record<string, (...args: string[]) => string>,
    ) => string;
    const op = {
      notExists: (a: string) => `attribute_not_exists(${a})`,
      eq: (a: string, v: string) => `${a} = ${v}`,
    };
    expect(
      condition({ archivedAt: 'archivedAt', quizVersion: 'quizVersion' }, op),
    ).toBe('attribute_not_exists(archivedAt) AND quizVersion = 1');
  });

  it('refuses a save based on an older version than the stored quiz, without writing', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { ...quizContentItem, quizVersion: 2 },
      }),
    });

    await expect(
      callAs().updateContentItemQuiz({ ...input, quizVersion: 1 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('writes version N+1 and conditions on the client version when it matches', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { ...quizContentItem, quizVersion: 4 },
      }),
    });

    await callAs().updateContentItemQuiz({ ...input, quizVersion: 4 });

    expect(contentItemPatchSet).toHaveBeenCalledWith(
      expect.objectContaining({ quizVersion: 5 }),
    );
    const condition = contentItemPatchWhere.mock.calls[0][0] as (
      attr: Record<string, string>,
      op: Record<string, (...args: unknown[]) => string>,
    ) => string;
    expect(
      condition(
        { archivedAt: 'archivedAt', quizVersion: 'quizVersion' },
        {
          notExists: (a) => `attribute_not_exists(${a})`,
          eq: (a, v) => `${a} = ${v}`,
        },
      ),
    ).toBe('attribute_not_exists(archivedAt) AND quizVersion = 4');
  });

  it('reports CONFLICT when another save landed first', async () => {
    transactionGo.mockResolvedValue({
      canceled: true,
      data: [{}, {}, { code: 'ConditionalCheckFailed' }],
    });

    await expect(callAs().updateContentItemQuiz(input)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('reports the archive, not a conflict, when the quiz was archived after the checks', async () => {
    transactionGo.mockResolvedValue({
      canceled: true,
      data: [{}, {}, { code: 'ConditionalCheckFailed' }],
    });
    contentItemGet
      .mockReturnValueOnce({
        go: vi.fn().mockResolvedValue({ data: quizContentItem }),
      })
      .mockReturnValueOnce({
        go: vi.fn().mockResolvedValue({
          data: { ...quizContentItem, archivedAt: '2024-02-01T00:00:00.000Z' },
        }),
      });

    await expect(callAs().updateContentItemQuiz(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });
});
