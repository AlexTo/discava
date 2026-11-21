/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  CONTENT_ITEM_ID,
  COURSE_ID,
  conditionalCheckFailedError,
  contentItem,
  contentItemGet,
  contentItemPatchSet,
  contentItemPatchWhere,
  courseInstructorGet,
  INSTRUCTOR_SUB,
  installDefaults,
  LESSON_ID,
  MODULE_ID,
  moduleGet,
  textContentItem,
  transactionWrite,
} from './content-item-video.fixtures.js';
import { updateContentItemVideoQuestions } from './content-item-video-questions.js';

const { mockModule } = await vi.hoisted(
  async () => (await import('./content-item-video.fixtures.js')).spies,
);

vi.mock('@discava/core-table', async (importOriginal) =>
  mockModule(await importOriginal()),
);

const router = t.router({ updateContentItemVideoQuestions });

const callAs = (sub = INSTRUCTOR_SUB, groups = ['instructor']) =>
  callerFor(router, { sub, groups });

const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

const question = (
  questionId: string,
  atSeconds: number | null,
  prompt = doc(questionId),
) => ({
  questionId,
  kind: 'single' as const,
  prompt,
  options: [
    { optionId: 'a', text: 'Yes' },
    { optionId: 'b', text: 'No' },
  ],
  atSeconds,
});

const keyFor = (questions: { questionId: string }[]) =>
  Object.fromEntries(
    questions.map(({ questionId }) => [
      questionId,
      { correctOptionIds: ['a'] },
    ]),
  );

const input = (
  questions: ReturnType<typeof question>[],
  extra: Record<string, unknown> = {},
) => ({
  courseId: COURSE_ID,
  moduleId: MODULE_ID,
  lessonId: LESSON_ID,
  contentItemId: CONTENT_ITEM_ID,
  quizVersion: 0,
  questions,
  answerKey: keyFor(questions),
  ...extra,
});

const savedQuestions = () =>
  contentItemPatchSet.mock.calls[0]![0].questions as {
    questionId: string;
    contentHash: string;
  }[];

beforeEach(() => {
  installDefaults();
  contentItemPatchSet.mockReturnValue({ where: contentItemPatchWhere });
  contentItemPatchWhere.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: contentItem }),
  });
});

describe('updateContentItemVideoQuestions', () => {
  it('saves the questions, the key and the next version', async () => {
    const questions = [question('q1', 5)];

    await callAs().updateContentItemVideoQuestions(input(questions));

    expect(contentItemPatchSet).toHaveBeenCalledWith({
      questions: [expect.objectContaining({ questionId: 'q1', atSeconds: 5 })],
      answerKey: keyFor(questions),
      quizVersion: 1,
    });
    expect(savedQuestions()[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns the item as stored', async () => {
    const stored = { ...contentItem, quizVersion: 1 };
    // Read before the write at version 0, and again after it.
    contentItemGet.mockReturnValueOnce({
      go: vi.fn().mockResolvedValue({ data: contentItem }),
    });
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: stored }),
    });

    await expect(
      callAs().updateContentItemVideoQuestions(input([question('q1', 1)])),
    ).resolves.toMatchObject({ quizVersion: 1 });
  });

  it('stores timed questions by moment, then end questions, keeping the sent order for ties', async () => {
    await callAs().updateContentItemVideoQuestions(
      input([
        question('end1', null),
        question('late', 30),
        question('tieA', 10),
        question('end2', null),
        question('tieB', 10),
        question('early', 2),
      ]),
    );

    expect(savedQuestions().map((q) => q.questionId)).toEqual([
      'early',
      'tieA',
      'tieB',
      'late',
      'end1',
      'end2',
    ]);
  });

  it('keeps the contentHash when only the time, key or explanation changes, and changes it with the prompt or an option', async () => {
    const hashOf = async (
      q: ReturnType<typeof question>,
      answerKey?: Record<string, unknown>,
    ) => {
      contentItemPatchSet.mockClear();
      await callAs().updateContentItemVideoQuestions(
        input([q], answerKey ? { answerKey } : {}),
      );
      return savedQuestions()[0]!.contentHash;
    };
    const base = question('q1', 5);
    const baseHash = await hashOf(base);

    expect(await hashOf({ ...base, atSeconds: 9 })).toBe(baseHash);
    expect(await hashOf({ ...base, atSeconds: null })).toBe(baseHash);
    expect(
      await hashOf(base, {
        q1: { correctOptionIds: ['b'], explanation: doc('Because') },
      }),
    ).toBe(baseHash);
    expect(await hashOf({ ...base, prompt: doc('Different?') })).not.toBe(
      baseHash,
    );
    expect(
      await hashOf({
        ...base,
        options: [
          { optionId: 'a', text: 'Yes!' },
          { optionId: 'b', text: 'No' },
        ],
      }),
    ).not.toBe(baseHash);
  });

  it('saves an empty list, removing every question', async () => {
    contentItemGet.mockReturnValue({
      go: vi
        .fn()
        .mockResolvedValue({ data: { ...contentItem, quizVersion: 3 } }),
    });

    await callAs().updateContentItemVideoQuestions(
      input([], { quizVersion: 3 }),
    );

    expect(contentItemPatchSet).toHaveBeenCalledWith({
      questions: [],
      answerKey: {},
      quizVersion: 4,
    });
  });

  it('touches nothing else on the item', async () => {
    await callAs().updateContentItemVideoQuestions(input([question('q1', 1)]));

    expect(Object.keys(contentItemPatchSet.mock.calls[0]![0]).sort()).toEqual([
      'answerKey',
      'questions',
      'quizVersion',
    ]);
  });

  it('conditions the write on the item not being archived and no version when 0 was sent', async () => {
    await callAs().updateContentItemVideoQuestions(input([question('q1', 1)]));

    const [where] = contentItemPatchWhere.mock.calls[0]!;
    const op = {
      eq: (a: string, v: number) => `${a} = ${v}`,
      notExists: (a: string) => `notExists(${a})`,
    };
    expect(
      where({ archivedAt: 'archivedAt', quizVersion: 'quizVersion' }, op),
    ).toBe('notExists(archivedAt) AND notExists(quizVersion)');
  });

  it('conditions the write on the version sent otherwise', async () => {
    contentItemGet.mockReturnValue({
      go: vi
        .fn()
        .mockResolvedValue({ data: { ...contentItem, quizVersion: 2 } }),
    });

    await callAs().updateContentItemVideoQuestions(
      input([question('q1', 1)], { quizVersion: 2 }),
    );

    const [where] = contentItemPatchWhere.mock.calls[0]!;
    const op = {
      eq: (a: string, v: number) => `${a} = ${v}`,
      notExists: (a: string) => `notExists(${a})`,
    };
    expect(
      where({ archivedAt: 'archivedAt', quizVersion: 'quizVersion' }, op),
    ).toBe('notExists(archivedAt) AND quizVersion = 2');
  });

  it('refuses a version that is not the stored one (CONFLICT), writing nothing', async () => {
    contentItemGet.mockReturnValue({
      go: vi
        .fn()
        .mockResolvedValue({ data: { ...contentItem, quizVersion: 2 } }),
    });

    await expect(
      callAs().updateContentItemVideoQuestions(
        input([question('q1', 1)], { quizVersion: 1 }),
      ),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message:
        'The questions were modified by another request; reload them and retry',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('gives CONFLICT to the second of two saves from one version', async () => {
    contentItemPatchWhere
      .mockReturnValueOnce({
        go: vi.fn().mockResolvedValue({ data: contentItem }),
      })
      .mockReturnValueOnce({
        go: vi.fn().mockRejectedValue(conditionalCheckFailedError()),
      });
    const save = () =>
      callAs().updateContentItemVideoQuestions(input([question('q1', 1)]));

    const results = await Promise.allSettled([save(), save()]);

    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const rejected = results.find((r) => r.status === 'rejected') as
      | PromiseRejectedResult
      | undefined;
    expect(rejected?.reason).toMatchObject({ code: 'CONFLICT' });
  });

  it('is NOT_FOUND for a missing item', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: null }),
    });

    await expect(
      callAs().updateContentItemVideoQuestions(input([])),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('is BAD_REQUEST for an item that is not a video', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: textContentItem }),
    });

    await expect(
      callAs().updateContentItemVideoQuestions(input([])),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: "Content item is type 'text', not 'video'",
    });
  });

  it('refuses an archived item', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { ...contentItem, archivedAt: '2024-01-01T00:00:00.000Z' },
      }),
    });

    await expect(
      callAs().updateContentItemVideoQuestions(input([])),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the content item before editing it',
    });
  });

  it('refuses a video under an archived module', async () => {
    moduleGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: {
          moduleId: MODULE_ID,
          visibility: 'hidden',
          archivedAt: '2024-01-01T00:00:00.000Z',
        },
      }),
    });

    await expect(
      callAs().updateContentItemVideoQuestions(input([])),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('refuses an instructor of another course', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: null }),
    });

    await expect(
      callAs().updateContentItemVideoQuestions(input([])),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('refuses a caller who is not an instructor', async () => {
    await expect(
      callAs('student-1', ['student']).updateContentItemVideoQuestions(
        input([]),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('refuses an invalid question or a 21st question (BAD_REQUEST)', async () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => question(`q${i}`, 1));

    await expect(
      callAs().updateContentItemVideoQuestions(input(tooMany)),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      callAs().updateContentItemVideoQuestions(input([question('q1', -1)])),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
