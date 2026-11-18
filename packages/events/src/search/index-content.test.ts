/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DynamoDBStreamSchema } from '@aws-lambda-powertools/parser/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

const { getOpenSearchClientMock, createCoreTableServiceMock, courseGet } =
  vi.hoisted(() => ({
    getOpenSearchClientMock: vi.fn(),
    createCoreTableServiceMock: vi.fn(),
    courseGet: vi.fn(),
  }));

vi.mock('@discava/search', async (importActual) => {
  const actual = await importActual<typeof import('@discava/search')>();
  return { ...actual, getOpenSearchClient: getOpenSearchClientMock };
});

vi.mock('@discava/core-table', async (importActual) => {
  const actual = await importActual<typeof import('@discava/core-table')>();
  return { ...actual, createCoreTableService: createCoreTableServiceMock };
});

const { searchIndexing } = await import('./index-content.js');

type StreamEvent = z.infer<typeof DynamoDBStreamSchema>;
type StreamRecord = StreamEvent['Records'][number];

const record = (
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
  oldImage?: Record<string, unknown>,
  newImage?: Record<string, unknown>,
) =>
  ({
    eventName,
    dynamodb: { OldImage: oldImage, NewImage: newImage },
  }) as unknown as StreamRecord;

// A change to a course. What the record says is deliberately not what the
// table holds, to show the handler reads the table.
const courseChange = (
  courseId = 'c1',
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE' = 'MODIFY',
) =>
  eventName === 'REMOVE'
    ? record(eventName, { __edb_e__: 'course', courseId })
    : record(eventName, undefined, {
        __edb_e__: 'course',
        courseId,
        title: 'From the record',
        status: 'published',
      });

const event = (...records: StreamRecord[]) => ({ Records: records });

const stored = (overrides: Record<string, unknown> = {}) => ({
  courseId: 'c1',
  title: 'Intro',
  description: 'About it',
  imageKey: 'courses/c1/image.png',
  status: 'published',
  publishedAt: '2024-01-01',
  updatedAt: '2024-01-02',
  ...overrides,
});

// The index as a map from course id to document, driven by the mock's calls.
const fakeIndex = () => {
  const docs = new Map<string, unknown>();
  client.index.mockImplementation(async ({ id, body }) => {
    docs.set(id, body);
    return {};
  });
  client.delete.mockImplementation(async ({ id }) => {
    docs.delete(id);
    return {};
  });
  return docs;
};

const client = { index: vi.fn(), delete: vi.fn() };

describe('searchIndexing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOpenSearchClientMock.mockResolvedValue(client);
    createCoreTableServiceMock.mockResolvedValue({
      entities: { course: { get: courseGet } },
    });
    courseGet.mockReturnValue({ go: async () => ({ data: stored() }) });
    client.index.mockResolvedValue({});
    client.delete.mockResolvedValue({});
  });

  const stub = (courses: Record<string, Record<string, unknown> | null>) =>
    courseGet.mockImplementation(({ courseId }: { courseId: string }) => ({
      go: async () => ({ data: courses[courseId] ?? null }),
    }));

  it('indexes a published course from the table, not from the record', async () => {
    await searchIndexing(event(courseChange()));

    expect(courseGet).toHaveBeenCalledWith({ courseId: 'c1' });
    expect(client.index).toHaveBeenCalledWith({
      index: 'courses',
      id: 'c1',
      body: expect.objectContaining({
        courseId: 'c1',
        title: 'Intro',
        description: 'About it',
        imageKey: 'courses/c1/image.png',
        status: 'published',
      }),
    });
    expect(client.delete).not.toHaveBeenCalled();
  });

  it('indexes the catalogue fields of a course that has them, and none otherwise', async () => {
    courseGet.mockReturnValue({
      go: async () => ({
        data: stored({
          categoryId: 'cat-1',
          tags: ['sql'],
          level: 'beginner',
          language: 'en',
          durationHours: 12,
        }),
      }),
    });
    await searchIndexing(event(courseChange()));
    expect(client.index.mock.calls[0]![0].body).toMatchObject({
      categoryId: 'cat-1',
      tags: ['sql'],
      level: 'beginner',
      language: 'en',
      durationHours: 12,
    });

    courseGet.mockReturnValue({ go: async () => ({ data: stored() }) });
    await searchIndexing(event(courseChange()));
    expect(client.index.mock.calls[1]![0].body.categoryId).toBeUndefined();
  });

  it('reads the course consistently, so it sees the write that triggered the batch', async () => {
    const go = vi.fn(async () => ({ data: stored() }));
    courseGet.mockReturnValue({ go });

    await searchIndexing(event(courseChange()));

    expect(go).toHaveBeenCalledWith({ consistent: true });
  });

  it.each(['draft', 'archived'])(
    'deletes a course the table holds as %s, whatever the record says',
    async (status) => {
      stub({ c1: stored({ status }) });

      await searchIndexing(event(courseChange()));

      expect(client.delete).toHaveBeenCalledWith({
        index: 'courses',
        id: 'c1',
      });
      expect(client.index).not.toHaveBeenCalled();
    },
  );

  it('deletes a removed course the table no longer holds', async () => {
    stub({ c1: null });

    await searchIndexing(event(courseChange('c1', 'REMOVE')));

    expect(client.delete).toHaveBeenCalledWith({ index: 'courses', id: 'c1' });
    expect(client.index).not.toHaveBeenCalled();
  });

  it('does not fail when the document to delete was never indexed', async () => {
    stub({ c1: stored({ status: 'archived' }) });
    client.delete.mockRejectedValue({ meta: { statusCode: 404 } });

    await expect(searchIndexing(event(courseChange()))).resolves.not.toThrow();
  });

  it('fails the batch when a delete fails for any other reason', async () => {
    stub({ c1: stored({ status: 'archived' }) });
    client.delete.mockRejectedValue({ meta: { statusCode: 500 } });

    await expect(searchIndexing(event(courseChange()))).rejects.toBeDefined();
  });

  it('ignores a record for anything but a course', async () => {
    await searchIndexing(
      event(
        record('MODIFY', undefined, {
          __edb_e__: 'lesson',
          lessonId: 'l1',
          courseId: 'c1',
        }),
      ),
    );

    expect(courseGet).not.toHaveBeenCalled();
    expect(client.index).not.toHaveBeenCalled();
    expect(client.delete).not.toHaveBeenCalled();
  });

  describe('order and duplicates', () => {
    const published = record('MODIFY', undefined, {
      __edb_e__: 'course',
      courseId: 'c1',
      status: 'published',
    });
    const unpublished = record('MODIFY', undefined, {
      __edb_e__: 'course',
      courseId: 'c1',
      status: 'archived',
    });

    it.each([
      ['published then unpublished', [published, unpublished]],
      ['unpublished then published', [unpublished, published]],
      ['each twice', [published, unpublished, published, unpublished]],
    ])(
      'leaves an unpublished course out of the index: %s',
      async (_, records) => {
        const docs = fakeIndex();
        stub({ c1: stored({ status: 'archived' }) });

        await searchIndexing(event(...records));
        // A redelivery of the same batch, in the other order.
        await searchIndexing(event(...[...records].reverse()));

        expect(docs.has('c1')).toBe(false);
      },
    );

    it('keeps a removed course out when an older edit arrives afterwards', async () => {
      const docs = fakeIndex();
      stub({ c1: null });

      await searchIndexing(event(courseChange('c1', 'REMOVE')));
      await searchIndexing(event(courseChange('c1', 'MODIFY')));

      expect(docs.has('c1')).toBe(false);
    });

    it('leaves the newer title and description whichever edit arrives last', async () => {
      const docs = fakeIndex();
      const older = record('MODIFY', undefined, {
        __edb_e__: 'course',
        courseId: 'c1',
        title: 'Older',
        status: 'published',
      });
      const newer = record('MODIFY', undefined, {
        __edb_e__: 'course',
        courseId: 'c1',
        title: 'Newer',
        status: 'published',
      });
      stub({ c1: stored({ title: 'Newer', description: 'Newer text' }) });

      await searchIndexing(event(newer, older));
      expect(docs.get('c1')).toMatchObject({
        title: 'Newer',
        description: 'Newer text',
      });

      await searchIndexing(event(older, newer));
      expect(docs.get('c1')).toMatchObject({
        title: 'Newer',
        description: 'Newer text',
      });
    });
  });

  it('reads a course once however many records name it', async () => {
    await searchIndexing(
      event(...Array.from({ length: 25 }, () => courseChange('c1'))),
    );

    expect(courseGet).toHaveBeenCalledTimes(1);
    expect(client.index).toHaveBeenCalledTimes(1);
  });

  it('reads each distinct course once', async () => {
    stub({ c1: stored(), c2: stored({ courseId: 'c2', status: 'draft' }) });

    await searchIndexing(
      event(courseChange('c1'), courseChange('c2'), courseChange('c1')),
    );

    expect(courseGet).toHaveBeenCalledTimes(2);
    expect(client.index).toHaveBeenCalledTimes(1);
    expect(client.delete).toHaveBeenCalledWith({ index: 'courses', id: 'c2' });
  });

  it('fails the batch when a course record names no course', async () => {
    await expect(
      searchIndexing(
        event(
          record('MODIFY', undefined, { __edb_e__: 'course', title: 'No id' }),
        ),
      ),
    ).rejects.toThrow(/course/i);
    expect(client.index).not.toHaveBeenCalled();
  });

  it('fails the batch when the core table cannot be read', async () => {
    courseGet.mockReturnValue({
      go: async () => {
        throw new Error('ProvisionedThroughputExceeded');
      },
    });

    await expect(searchIndexing(event(courseChange()))).rejects.toThrow(
      'ProvisionedThroughputExceeded',
    );
    expect(client.index).not.toHaveBeenCalled();
    expect(client.delete).not.toHaveBeenCalled();
  });
});
