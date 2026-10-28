/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  createContentItemText,
  updateContentItemText,
} from './content-item-text.js';

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
}));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
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
  createContentItemText,
  updateContentItemText,
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

const textBody = JSON.stringify({
  type: 'doc',
  content: [{ type: 'paragraph' }],
});

const textContentItem = {
  contentItemId: CONTENT_ITEM_ID,
  lessonId: LESSON_ID,
  moduleId: MODULE_ID,
  courseId: COURSE_ID,
  type: 'text' as const,
  status: 'ready' as const,
  title: 'Welcome notes',
  body: textBody,
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
    go: vi.fn().mockResolvedValue({ data: textContentItem }),
  });
  contentItemPatch.mockReturnValue({ set: contentItemPatchSet });
  contentItemPatchSet.mockReturnValue({
    where: () => ({ commit: () => ({}) }),
  });
  const ancestorCheck = () => ({
    where: () => ({ commit: () => ({}) }),
  });
  const lessonPatch = () => ({
    set: () => ({ where: () => ({ commit: () => ({}) }) }),
  });
  transactionWrite.mockImplementation((fn) => {
    fn({
      course: { check: ancestorCheck },
      module: { check: ancestorCheck },
      // Appending to the lesson claims its next order (#71).
      lesson: { check: ancestorCheck, patch: lessonPatch },
      contentItem: { create: contentItemCreate, patch: contentItemPatch },
    });
    return { go: transactionGo };
  });
  transactionGo.mockResolvedValue({ canceled: false, data: [] });
});

describe('createContentItemText', () => {
  const validTextInput = {
    courseId: COURSE_ID,
    moduleId: MODULE_ID,
    lessonId: LESSON_ID,
    title: 'Welcome notes',
    body: textBody,
  };

  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).createContentItemText(validTextInput),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the lesson does not exist', async () => {
    lessonGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().createContentItemText(validTextInput),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(contentItemCreate).not.toHaveBeenCalled();
  });

  it('accepts a body with inline and block maths', async () => {
    const body = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Solve ' },
            { type: 'inlineMath', attrs: { latex: 'Ax = b' } },
          ],
        },
        { type: 'blockMath', attrs: { latex: '\\frac{a}{b}' } },
      ],
    });

    await callAs().createContentItemText({ ...validTextInput, body });

    expect(contentItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({ body }),
    );
  });

  it.each([
    ['JSON that is not a document', '{}'],
    [
      'a node the editor has no extension for',
      JSON.stringify({ type: 'doc', content: [{ type: 'image' }] }),
    ],
    ['text that is not JSON', 'not json'],
  ])('rejects a body of %s, writing nothing', async (_, body) => {
    await expect(
      callAs().createContentItemText({ ...validTextInput, body }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(contentItemCreate).not.toHaveBeenCalled();
  });

  it('generates a contentItemId and persists the body without touching S3', async () => {
    const result = await callAs().createContentItemText(validTextInput);

    expect(contentItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'text',
        body: textBody,
        order: 1,
        contentItemId: expect.any(String),
      }),
    );
    expect(result).toEqual(textContentItem);
  });

  it('appends after the highest existing order', async () => {
    contentItemQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: [{ ...textContentItem, order: 3 }],
      }),
    });

    await callAs().createContentItemText(validTextInput);

    expect(contentItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({ order: 4 }),
    );
  });
});

describe('updateContentItemText', () => {
  const input = {
    courseId: COURSE_ID,
    moduleId: MODULE_ID,
    lessonId: LESSON_ID,
    contentItemId: CONTENT_ITEM_ID,
  };

  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).updateContentItemText(input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the content item does not exist', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(callAs().updateContentItemText(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(contentItemPatch).not.toHaveBeenCalled();
  });

  it('patches the body without touching S3 cleanup', async () => {
    const newBody = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
    });

    await callAs().updateContentItemText({ ...input, body: newBody });

    expect(contentItemPatchSet).toHaveBeenCalledWith({ body: newBody });
  });

  it('throws BAD_REQUEST when the existing content item is not text', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: contentItem }),
    });

    await expect(
      callAs().updateContentItemText({ ...input, body: textBody }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(contentItemPatch).not.toHaveBeenCalled();
  });
});
