/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DynamoDBStreamSchema } from '@aws-lambda-powertools/parser/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

const { getOpenSearchClientMock } = vi.hoisted(() => ({
  getOpenSearchClientMock: vi.fn(),
}));

vi.mock('@discava/search', async (importActual) => {
  const actual = await importActual<typeof import('@discava/search')>();
  return { ...actual, getOpenSearchClient: getOpenSearchClientMock };
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

describe('searchIndexing', () => {
  const client = { index: vi.fn(), delete: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    getOpenSearchClientMock.mockResolvedValue(client);
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

  it('ignores a record for anything but a course', async () => {
    const event = {
      Records: [
        record('MODIFY', undefined, {
          __edb_e__: 'lesson',
          lessonId: 'l1',
          courseId: 'c1',
        }),
      ],
    } as z.infer<typeof DynamoDBStreamSchema>;

    await searchIndexing(event);

    expect(client.index).not.toHaveBeenCalled();
    expect(client.delete).not.toHaveBeenCalled();
  });
});
