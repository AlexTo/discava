/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { videoUrl } from './content-item.js';

// What the mocked table holds for this test; each entity's `get` reads it.
const { db, getSignedCloudFrontCookies } = vi.hoisted(() => ({
  db: {} as Record<string, any>,
  getSignedCloudFrontCookies: vi.fn(),
}));

const stored = (name: string) => ({
  get: vi.fn(() => ({
    go: vi.fn(async () => ({ data: db[name] ?? null })),
  })),
});

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: Object.fromEntries(
      ['course', 'module', 'lesson', 'contentItem', 'enrolment'].map((name) => [
        name,
        stored(name),
      ]),
    ),
  })),
}));

vi.mock('../lib/cloudfront-client.js', () => ({
  getCloudFrontVideoUrl: vi.fn(
    async (key: string) => `https://media.example.com/${key}`,
  ),
  getSignedCloudFrontCookies,
}));

const caller = t.createCallerFactory(t.router({ videoUrl }));

const USER_SUB = 'student-1';

const call = (responseCookies: string[] = []) =>
  caller({
    event: {
      requestContext: { authorizer: { claims: { sub: USER_SUB } } },
    } as unknown as APIGatewayProxyEvent,
    context: {} as any,
    info: {} as any,
    responseCookies,
  });

const ref = {
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
  contentItemId: 'item-1',
};

const MANIFEST =
  'courses/course-1/modules/module-1/lessons/lesson-1/content-items/item-1/nonce-1/master.m3u8';

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(db)) {
    delete db[key];
  }
  db.course = { courseId: 'course-1', status: 'published' };
  db.module = { ...ref, visibility: 'visible' };
  db.lesson = { ...ref, visibility: 'visible' };
  db.contentItem = {
    ...ref,
    type: 'video',
    status: 'ready',
    s3Key: MANIFEST,
    visibility: 'visible',
  };
  db.enrolment = { courseId: 'course-1', userId: USER_SUB, status: 'active' };
  getSignedCloudFrontCookies.mockResolvedValue([
    'CloudFront-Policy=p; Domain=example.com',
    'CloudFront-Signature=s; Domain=example.com',
  ]);
});

describe('contentItem.videoUrl', () => {
  it("returns an enrolled student the video's manifest and sets cookies for its directory", async () => {
    const responseCookies: string[] = [];

    await expect(call(responseCookies).videoUrl(ref)).resolves.toEqual({
      url: `https://media.example.com/${MANIFEST}`,
    });
    expect(getSignedCloudFrontCookies).toHaveBeenCalledWith(
      'courses/course-1/modules/module-1/lessons/lesson-1/content-items/item-1/nonce-1/',
    );
    expect(responseCookies).toEqual([
      'CloudFront-Policy=p; Domain=example.com',
      'CloudFront-Signature=s; Domain=example.com',
    ]);
  });

  it('still plays in an archived course the student is enrolled in', async () => {
    db.course.status = 'archived';

    await expect(call().videoUrl(ref)).resolves.toHaveProperty('url');
  });

  it.each([
    ['not enrolled', () => delete db.enrolment],
    ['dropped', () => (db.enrolment.status = 'dropped')],
  ])('is FORBIDDEN to a student who is %s', async (_, arrange) => {
    arrange();

    await expect(call().videoUrl(ref)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(getSignedCloudFrontCookies).not.toHaveBeenCalled();
  });

  it('is NOT_FOUND for a draft course, without saying it exists', async () => {
    db.course.status = 'draft';
    delete db.enrolment;

    await expect(call().videoUrl(ref)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it.each([
    ['the course is gone', () => delete db.course],
    ['the item is gone', () => delete db.contentItem],
    ['its module is hidden', () => (db.module.visibility = 'hidden')],
    ['its lesson is archived', () => (db.lesson.archivedAt = '2024-01-01')],
    ['it is hidden', () => (db.contentItem.visibility = 'hidden')],
    ['it is archived', () => (db.contentItem.archivedAt = '2024-01-01')],
    ['it is not a video', () => (db.contentItem.type = 'text')],
    ['it is still transcoding', () => (db.contentItem.status = 'pending')],
    ['it has no stream yet', () => delete db.contentItem.s3Key],
  ])('is NOT_FOUND when %s', async (_, arrange) => {
    arrange();

    await expect(call().videoUrl(ref)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(getSignedCloudFrontCookies).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated callers', async () => {
    const anonymous = caller({
      event: { requestContext: {} } as unknown as APIGatewayProxyEvent,
      context: {} as any,
      info: {} as any,
    });

    await expect(anonymous.videoUrl(ref)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});
