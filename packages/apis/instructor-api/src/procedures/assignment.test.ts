/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  createQuizAssignment,
  createUploadAssignment,
  updateContentItemAssignment,
} from './assignment.js';

const {
  transactionWrite,
  transactionGo,
  courseGet,
  courseInstructorGet,
  moduleGet,
  modulePatch,
  lessonGet,
  lessonCreate,
  lessonQueryPrimary,
  contentItemGet,
  contentItemCreate,
  contentItemPatch,
  patchSet,
  patchRemove,
} = vi.hoisted(() => ({
  transactionWrite: vi.fn(),
  transactionGo: vi.fn(),
  courseGet: vi.fn(),
  courseInstructorGet: vi.fn(),
  moduleGet: vi.fn(),
  modulePatch: vi.fn(),
  lessonGet: vi.fn(),
  lessonCreate: vi.fn(),
  lessonQueryPrimary: vi.fn(),
  contentItemGet: vi.fn(),
  contentItemCreate: vi.fn(),
  contentItemPatch: vi.fn(),
  patchSet: vi.fn(),
  patchRemove: vi.fn(),
}));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: {
      course: { get: courseGet },
      courseInstructor: { get: courseInstructorGet },
      module: { get: moduleGet },
      lesson: {
        get: lessonGet,
        create: lessonCreate,
        query: { primary: lessonQueryPrimary },
      },
      contentItem: {
        get: contentItemGet,
        create: contentItemCreate,
        patch: contentItemPatch,
      },
    },
    transaction: { write: transactionWrite },
  })),
}));

const caller = t.createCallerFactory(
  t.router({
    createQuizAssignment,
    createUploadAssignment,
    updateContentItemAssignment,
  }),
);

const INSTRUCTOR_SUB = 'instructor-1';
const COURSE_ID = 'course-1';
const MODULE_ID = 'module-1';
const LESSON_ID = 'lesson-1';
const CONTENT_ITEM_ID = 'content-item-1';

const callAs = (groups: string[] = ['instructor']) =>
  caller({
    event: {
      requestContext: {
        authorizer: {
          claims: { sub: INSTRUCTOR_SUB, 'cognito:groups': groups },
        },
      },
    } as unknown as APIGatewayProxyEvent,
    context: {} as any,
    info: {} as any,
  });

const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

const quiz = {
  questions: [
    {
      questionId: 'q1',
      kind: 'single' as const,
      prompt: doc('Which service runs containers without servers?'),
      options: [
        { optionId: 'a', text: 'EC2' },
        { optionId: 'b', text: 'Fargate' },
      ],
    },
  ],
  answerKey: { q1: { correctOptionIds: ['b'] } },
  settings: {
    passMarkPercent: 80,
    attemptsAllowed: 3,
    shuffleOptions: false,
    revealAnswers: 'after_each_attempt' as const,
  },
};

const timestamps = {
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const assignmentLesson = {
  lessonId: LESSON_ID,
  moduleId: MODULE_ID,
  courseId: COURSE_ID,
  kind: 'assignment' as const,
  title: 'Module project',
  order: 3,
  visibility: 'visible' as const,
  ...timestamps,
};

const assignmentItem = {
  contentItemId: CONTENT_ITEM_ID,
  lessonId: LESSON_ID,
  moduleId: MODULE_ID,
  courseId: COURSE_ID,
  type: 'assignment' as const,
  status: 'ready' as const,
  title: 'Module project',
  body: doc('Build a serverless API'),
  maxPoints: 100,
  order: 1,
  visibility: 'visible' as const,
  studentActivityCount: 0,
  ...timestamps,
};

const targetInput = {
  courseId: COURSE_ID,
  moduleId: MODULE_ID,
  title: 'Module project',
};

const uploadInput = {
  ...targetInput,
  body: doc('Build a serverless API'),
  maxPoints: 100,
};

const setCourseStatus = (status: 'draft' | 'published' | 'archived') =>
  courseGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: { courseId: COURSE_ID, status } }),
  });

// The `set` and `remove` calls of every content item patch.
let patches: { set?: Record<string, unknown>; removed?: string[] }[];

beforeEach(() => {
  vi.clearAllMocks();
  patches = [];

  setCourseStatus('draft');
  courseInstructorGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({
      data: { courseId: COURSE_ID, instructorId: INSTRUCTOR_SUB },
    }),
  });
  moduleGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({
      data: { moduleId: MODULE_ID, visibility: 'visible', lastChildOrder: 2 },
    }),
  });
  lessonQueryPrimary.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: [{ order: 1 }, { order: 2 }] }),
  });
  lessonGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: assignmentLesson }),
  });
  lessonCreate.mockReturnValue({ commit: () => ({}) });
  contentItemCreate.mockReturnValue({ commit: () => ({}) });
  contentItemGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: assignmentItem }),
  });

  // contentItem.patch(key).set(values)[.remove(names)].where(fn).commit()
  const where = () => ({ commit: () => ({}) });
  contentItemPatch.mockImplementation(() => {
    const record: (typeof patches)[number] = {};
    patches.push(record);
    return {
      set: patchSet.mockImplementation((values: Record<string, unknown>) => {
        record.set = values;
        return {
          where,
          remove: patchRemove.mockImplementation((names: string[]) => {
            record.removed = names;
            return { where };
          }),
        };
      }),
    };
  });
  const check = () => ({ where: () => ({ commit: () => ({}) }) });
  modulePatch.mockReturnValue({
    set: () => ({ where: () => ({ commit: () => ({}) }) }),
  });
  transactionWrite.mockImplementation((build) => {
    build({
      course: { check },
      module: { check, patch: modulePatch },
      lesson: { check, create: lessonCreate },
      contentItem: { create: contentItemCreate, patch: contentItemPatch },
    });
    return { go: transactionGo };
  });
  transactionGo.mockResolvedValue({ canceled: false, data: [] });
});

describe('createUploadAssignment', () => {
  it('rejects callers who are not in the instructor group', async () => {
    await expect(
      callAs(['student']).createUploadAssignment(uploadInput),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('rejects an instructor who does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().createUploadAssignment(uploadInput),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('writes the assignment lesson and its one item in a single transaction', async () => {
    const result = await callAs().createUploadAssignment({
      ...uploadInput,
      dueAt: '2026-12-01T00:00:00.000Z',
    });

    expect(transactionWrite).toHaveBeenCalledTimes(1);
    expect(lessonCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        kind: 'assignment',
        title: 'Module project',
        // After the module's two lessons, with the item as its first child.
        order: 3,
        lastChildOrder: 1,
        visibility: 'visible',
      }),
    );
    const lessonId = lessonCreate.mock.calls[0][0].lessonId;
    expect(contentItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId,
        type: 'assignment',
        title: 'Module project',
        body: uploadInput.body,
        dueAt: '2026-12-01T00:00:00.000Z',
        maxPoints: 100,
        order: 1,
        visibility: 'visible',
      }),
    );
    expect(result).toEqual(assignmentLesson);
  });

  it('starts hidden in a course that is not a draft', async () => {
    setCourseStatus('published');

    await callAs().createUploadAssignment(uploadInput);

    expect(lessonCreate).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'hidden' }),
    );
    expect(contentItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'hidden' }),
    );
  });

  it('refuses to add one to an archived course', async () => {
    setCourseStatus('archived');

    await expect(
      callAs().createUploadAssignment(uploadInput),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('refuses to add one to an archived module', async () => {
    moduleGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { moduleId: MODULE_ID, archivedAt: '2024-02-01T00:00:00.000Z' },
      }),
    });

    await expect(
      callAs().createUploadAssignment(uploadInput),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the module does not exist', async () => {
    moduleGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().createUploadAssignment(uploadInput),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each([
    ['instructions that are not a Tiptap document', { body: 'plain text' }],
    ['no points', { maxPoints: 0 }],
    ['fractional points', { maxPoints: 2.5 }],
    ['more points than the limit', { maxPoints: 1001 }],
    ['a due date that is not a timestamp', { dueAt: 'next Friday' }],
    ['an empty title', { title: '' }],
  ])('rejects %s', async (_, override) => {
    await expect(
      callAs().createUploadAssignment({ ...uploadInput, ...override }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });
});

describe('createQuizAssignment', () => {
  it('writes a quiz item the way a quiz content item is written', async () => {
    await callAs().createQuizAssignment({ ...targetInput, ...quiz });

    expect(lessonCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'assignment',
        order: 3,
        lastChildOrder: 1,
      }),
    );
    expect(contentItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'quiz',
        title: 'Module project',
        questions: quiz.questions,
        answerKey: quiz.answerKey,
        settings: quiz.settings,
        quizVersion: 1,
        questionsHash: expect.any(String),
        order: 1,
      }),
    );
  });

  it('rejects a quiz whose answer key does not match its questions', async () => {
    await expect(
      callAs().createQuizAssignment({
        ...targetInput,
        ...quiz,
        answerKey: { q1: { correctOptionIds: ['missing'] } },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });
});

describe('updateContentItemAssignment', () => {
  const key = {
    courseId: COURSE_ID,
    moduleId: MODULE_ID,
    lessonId: LESSON_ID,
    contentItemId: CONTENT_ITEM_ID,
  };

  it('writes only the fields given', async () => {
    const result = await callAs().updateContentItemAssignment({
      ...key,
      maxPoints: 50,
      dueAt: '2026-12-01T00:00:00.000Z',
    });

    expect(patches).toEqual([
      { set: { dueAt: '2026-12-01T00:00:00.000Z', maxPoints: 50 } },
    ]);
    expect(contentItemPatch).toHaveBeenCalledWith(key);
    expect(result).toEqual(assignmentItem);
  });

  it('removes the due date when given null', async () => {
    await callAs().updateContentItemAssignment({ ...key, dueAt: null });

    expect(patches).toEqual([{ set: {}, removed: ['dueAt'] }]);
  });

  it('writes nothing when there is nothing to change', async () => {
    const result = await callAs().updateContentItemAssignment(key);

    expect(transactionWrite).not.toHaveBeenCalled();
    expect(result).toEqual(assignmentItem);
  });

  it('only edits upload assignments', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { ...assignmentItem, type: 'text' as const },
      }),
    });

    await expect(
      callAs().updateContentItemAssignment({ ...key, maxPoints: 10 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('refuses to edit an archived assignment', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { ...assignmentItem, archivedAt: '2024-02-01T00:00:00.000Z' },
      }),
    });

    await expect(
      callAs().updateContentItemAssignment({ ...key, maxPoints: 10 }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('rejects an instructor who does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().updateContentItemAssignment({ ...key, maxPoints: 10 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
