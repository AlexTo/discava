/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DynamoDBStreamSchema } from '@aws-lambda-powertools/parser/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

const { getOpenSearchClientMock, createCoreTableServiceMock } = vi.hoisted(
  () => ({
    getOpenSearchClientMock: vi.fn(),
    createCoreTableServiceMock: vi.fn(),
  }),
);

vi.mock('@discava/search', async (importActual) => {
  const actual = await importActual<typeof import('@discava/search')>();
  return { ...actual, getOpenSearchClient: getOpenSearchClientMock };
});
vi.mock('@discava/core-table', async (importActual) => {
  const actual = await importActual<typeof import('@discava/core-table')>();
  return { ...actual, createCoreTableService: createCoreTableServiceMock };
});

const { searchIndexing } = await import('./index-content.js');

type StreamRecord = z.infer<typeof DynamoDBStreamSchema>['Records'][number];

const record = (
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
  oldImage?: Record<string, unknown>,
  newImage?: Record<string, unknown>,
) =>
  ({
    eventName,
    dynamodb: { OldImage: oldImage, NewImage: newImage },
  }) as unknown as StreamRecord;

const goes = (data: unknown) => ({ go: vi.fn().mockResolvedValue({ data }) });

describe('searchIndexing', () => {
  const client = { index: vi.fn(), delete: vi.fn() };
  const coreTable = {
    entities: {
      course: { get: vi.fn() },
      module: { get: vi.fn() },
      lesson: { query: { primary: vi.fn() } },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getOpenSearchClientMock.mockResolvedValue(client);
    createCoreTableServiceMock.mockResolvedValue(coreTable);
    client.index.mockResolvedValue({});
    client.delete.mockResolvedValue({});
  });

  it('indexes a published course', async () => {
    const event = {
      Records: [
        record('INSERT', undefined, {
          __edb_e__: 'course',
          courseId: 'c1',
          title: 'Intro',
          status: 'published',
          publishedAt: '2024-01-01',
          updatedAt: '2024-01-02',
        }),
      ],
    } as z.infer<typeof DynamoDBStreamSchema>;

    await searchIndexing(event);

    expect(client.index).toHaveBeenCalledWith({
      index: 'courses',
      id: 'c1',
      body: expect.objectContaining({ courseId: 'c1', status: 'published' }),
    });
    expect(client.delete).not.toHaveBeenCalled();
  });

  it('deletes a course moved out of published (draft or archived)', async () => {
    const event = {
      Records: [
        record('MODIFY', undefined, {
          __edb_e__: 'course',
          courseId: 'c1',
          status: 'archived',
          updatedAt: '2024-01-02',
        }),
      ],
    } as z.infer<typeof DynamoDBStreamSchema>;

    await searchIndexing(event);

    expect(client.delete).toHaveBeenCalledWith({ index: 'courses', id: 'c1' });
    expect(client.index).not.toHaveBeenCalled();
  });

  it('deletes a removed course, from its old image', async () => {
    const event = {
      Records: [
        record('REMOVE', { __edb_e__: 'course', courseId: 'c1' }, undefined),
      ],
    } as z.infer<typeof DynamoDBStreamSchema>;

    await searchIndexing(event);

    expect(client.delete).toHaveBeenCalledWith({ index: 'courses', id: 'c1' });
  });

  it('indexes a lesson that is visible under a visible module and published course', async () => {
    coreTable.entities.module.get.mockReturnValue(
      goes({ visibility: 'visible' }),
    );
    coreTable.entities.course.get.mockReturnValue(
      goes({ status: 'published' }),
    );
    const event = {
      Records: [
        record('MODIFY', undefined, {
          __edb_e__: 'lesson',
          lessonId: 'l1',
          moduleId: 'm1',
          courseId: 'c1',
          title: 'Lesson one',
          visibility: 'visible',
          updatedAt: '2024-01-02',
        }),
      ],
    } as z.infer<typeof DynamoDBStreamSchema>;

    await searchIndexing(event);

    expect(client.index).toHaveBeenCalledWith({
      index: 'lessons',
      id: 'l1',
      body: expect.objectContaining({ lessonId: 'l1', courseId: 'c1' }),
    });
  });

  it('deletes a lesson whose course is not published, even if the lesson itself is visible', async () => {
    coreTable.entities.module.get.mockReturnValue(
      goes({ visibility: 'visible' }),
    );
    coreTable.entities.course.get.mockReturnValue(goes({ status: 'draft' }));
    const event = {
      Records: [
        record('MODIFY', undefined, {
          __edb_e__: 'lesson',
          lessonId: 'l1',
          moduleId: 'm1',
          courseId: 'c1',
          title: 'Lesson one',
          visibility: 'visible',
          updatedAt: '2024-01-02',
        }),
      ],
    } as z.infer<typeof DynamoDBStreamSchema>;

    await searchIndexing(event);

    expect(client.delete).toHaveBeenCalledWith({ index: 'lessons', id: 'l1' });
    expect(client.index).not.toHaveBeenCalled();
  });

  it('deletes a removed lesson, from its old image', async () => {
    const event = {
      Records: [
        record(
          'REMOVE',
          { __edb_e__: 'lesson', lessonId: 'l1', courseId: 'c1' },
          undefined,
        ),
      ],
    } as z.infer<typeof DynamoDBStreamSchema>;

    await searchIndexing(event);

    expect(client.delete).toHaveBeenCalledWith({ index: 'lessons', id: 'l1' });
  });

  it('reconciles every lesson under a module whose visibility changed', async () => {
    coreTable.entities.lesson.query.primary.mockReturnValue(
      goes([
        {
          lessonId: 'l1',
          moduleId: 'm1',
          courseId: 'c1',
          title: 'One',
          visibility: 'visible',
          updatedAt: 'x',
        },
        {
          lessonId: 'l2',
          moduleId: 'm1',
          courseId: 'c1',
          title: 'Two',
          visibility: 'visible',
          updatedAt: 'x',
        },
      ]),
    );
    coreTable.entities.course.get.mockReturnValue(
      goes({ status: 'published' }),
    );
    const event = {
      Records: [
        record('MODIFY', undefined, {
          __edb_e__: 'module',
          moduleId: 'm1',
          courseId: 'c1',
          visibility: 'hidden',
        }),
      ],
    } as z.infer<typeof DynamoDBStreamSchema>;

    await searchIndexing(event);

    // The module itself is hidden, so every one of its lessons is deleted,
    // even though each lesson's own visibility is 'visible'.
    expect(client.delete).toHaveBeenCalledWith({ index: 'lessons', id: 'l1' });
    expect(client.delete).toHaveBeenCalledWith({ index: 'lessons', id: 'l2' });
    expect(client.index).not.toHaveBeenCalled();
  });

  it('does nothing for a removed module: its lessons clean themselves up', async () => {
    const event = {
      Records: [
        record(
          'REMOVE',
          { __edb_e__: 'module', moduleId: 'm1', courseId: 'c1' },
          undefined,
        ),
      ],
    } as z.infer<typeof DynamoDBStreamSchema>;

    await searchIndexing(event);

    expect(coreTable.entities.lesson.query.primary).not.toHaveBeenCalled();
    expect(client.index).not.toHaveBeenCalled();
    expect(client.delete).not.toHaveBeenCalled();
  });
});
