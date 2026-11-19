/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createCoreTableService } from '../service.js';
import { useCoreTable } from '../test-support/core-table.js';
import { uuidV7At } from '../test-support/uuid-v7.js';
import {
  AnnouncementInputError,
  announcementDeleteWrites,
  announcementEditWrites,
  announcementIdTime,
  announcementPage,
  announcementWrites,
} from './announcement.js';
import * as notification from './notification.js';

vi.mock('./notification.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./notification.js')>();
  return {
    ...actual,
    notifyCourseStudents: vi.fn(actual.notifyCourseStudents),
  };
});

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;
const service = useCoreTable();

const NOW = new Date('2026-11-16T10:00:00.000Z');
const idAt = uuidV7At;
const ID = idAt(NOW);
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

const create = (over: Record<string, unknown> = {}) => ({
  courseId: 'course-1',
  courseTitle: 'History',
  announcementId: ID,
  title: '  Welcome  ',
  body: '{"type":"doc","content":[{"type":"paragraph"}]}',
  excerpt: 'Hello',
  authorId: 'instructor-1',
  now: NOW,
  ...over,
});

// The items as DynamoDB would receive them.
const part = (item: unknown) => {
  const [kind, request] = Object.entries(item as object)[0] as [
    string,
    Record<string, any>,
  ];
  return { kind, ...request };
};

describe('announcementIdTime', () => {
  it('is the time part of the id', () => {
    expect(announcementIdTime(ID, NOW)).toBe('2026-11-16T10:00:00.000Z');
  });

  it.each([
    ['ten minutes before', -10],
    ['a minute ahead', 1],
  ])('accepts an id from %s', (_, offset) => {
    expect(() => announcementIdTime(idAt(minutes(offset)), NOW)).not.toThrow();
  });

  it.each([
    ['11 minutes old', idAt(minutes(-11))],
    ['2 minutes ahead', idAt(minutes(2))],
    ['not a UUID', 'nope'],
    ['a version 4 UUID', '4f9b2a8e-3c1d-4e5f-8a7b-123456789abc'],
    ['a bad variant', '01a1eb76-d255-7000-c000-000000000001'],
  ])('refuses an id that is %s', (_, id) => {
    expect(() => announcementIdTime(id, NOW)).toThrow(AnnouncementInputError);
  });
});

describe('announcementWrites', () => {
  it('has the announcement, the membership check, the course check and the broadcast', () => {
    const items = announcementWrites(service, create()).map(part);

    expect(items.map((i) => i.kind)).toEqual([
      'Put',
      'ConditionCheck',
      'ConditionCheck',
      'Put',
    ]);
    const [post, member, course, broadcast] = items;
    expect(post.Item).toMatchObject({
      courseId: 'course-1',
      announcementId: ID,
      title: 'Welcome',
      authorId: 'instructor-1',
      createdAt: '2026-11-16T10:00:00.000Z',
      version: 1,
      __edb_e__: 'announcement',
    });
    expect(post.Item).not.toHaveProperty('editedAt');
    expect(post.ConditionExpression).toContain('attribute_not_exists');
    expect(member.Key.sk).toContain('courseinstructor');
    expect(member.Key.sk).toContain('instructor-1');
    expect(member.ConditionExpression).toContain('attribute_exists');
    expect(course.Key.sk).toContain('course');
    expect(course.ExpressionAttributeValues).toEqual({
      ':status0': 'published',
    });
    expect(broadcast.Item.__edb_e__).toBe('notificationBroadcast');
  });

  it('asks for the course students to be notified with the documented call', () => {
    vi.mocked(notification.notifyCourseStudents).mockClear();

    announcementWrites(service, create());

    expect(notification.notifyCourseStudents).toHaveBeenCalledTimes(1);
    expect(notification.notifyCourseStudents).toHaveBeenCalledWith(service, {
      type: 'announcement.posted',
      courseId: 'course-1',
      params: {
        courseId: 'course-1',
        courseTitle: 'History',
        announcementTitle: 'Welcome',
        excerpt: 'Hello',
      },
      dedupeKey: ID,
      occurredAt: '2026-11-16T10:00:00.000Z',
    });
  });

  it('gives the same dedupe key and time for the same input twice', () => {
    const first = announcementWrites(service, create()).map(part);
    const second = announcementWrites(service, create({ now: minutes(3) })).map(
      part,
    );

    expect(second[3].Item.id).toBe(first[3].Item.id);
    expect(second[3].Item.dedupeKey).toBe(first[3].Item.dedupeKey);
    expect(second[3].Item.occurredAt).toBe(first[3].Item.occurredAt);
    expect(second[0].Item.createdAt).toBe(first[0].Item.createdAt);
  });

  it('touches no notification entity but the one broadcast', () => {
    const entities = announcementWrites(service, create())
      .map(part)
      .map((i) => i.Item?.__edb_e__ ?? 'check');

    expect(entities).toEqual([
      'announcement',
      'check',
      'check',
      'notificationBroadcast',
    ]);
  });

  it.each([
    ['a bad id', { announcementId: 'nope' }],
    ['an id from 11 minutes ago', { announcementId: idAt(minutes(-11)) }],
    ['an id from 2 minutes ahead', { announcementId: idAt(minutes(2)) }],
    ['an empty title', { title: '   ' }],
    ['a 121-character title', { title: 'x'.repeat(121) }],
    ['a 20,001-character body', { body: 'x'.repeat(20_001) }],
    ['an empty body', { body: '' }],
  ])('refuses %s before building anything', (_, over) => {
    vi.mocked(notification.notifyCourseStudents).mockClear();

    expect(() => announcementWrites(service, create(over))).toThrow(
      AnnouncementInputError,
    );
    expect(notification.notifyCourseStudents).not.toHaveBeenCalled();
  });

  it('accepts a 120-character title and a 20,000-character body', () => {
    expect(() =>
      announcementWrites(
        service,
        create({ title: 'x'.repeat(120), body: 'x'.repeat(20_000) }),
      ),
    ).not.toThrow();
  });
});

describe('announcementEditWrites', () => {
  const edit = (over: Record<string, unknown> = {}) => ({
    courseId: 'course-1',
    announcementId: ID,
    instructorId: 'instructor-1',
    version: 2,
    title: ' New title ',
    now: NOW,
    ...over,
  });

  it('patches with editedAt and the next version, on the version it read', () => {
    const [patch, member] = announcementEditWrites(service, edit()).map(part);

    expect(patch.kind).toBe('Update');
    expect(patch.Key.sk).toContain(ID);
    expect(Object.values(patch.ExpressionAttributeValues)).toEqual(
      expect.arrayContaining(['New title', '2026-11-16T10:00:00.000Z', 3, 2]),
    );
    expect(patch.ConditionExpression).toMatch(/#version = :version\d/);
    expect(member.Key.sk).toContain('courseinstructor');
  });

  it('patches the body alone', () => {
    const [patch] = announcementEditWrites(
      service,
      edit({ title: undefined, body: '{"type":"doc"}' }),
    ).map(part);

    expect(patch.UpdateExpression).toContain('#body');
    expect(patch.UpdateExpression).not.toContain('#title');
  });

  it('needs a title or a body', () => {
    expect(() =>
      announcementEditWrites(service, edit({ title: undefined })),
    ).toThrow(AnnouncementInputError);
  });

  it.each([
    ['an empty title', { title: ' ' }],
    ['an oversized body', { body: 'x'.repeat(20_001) }],
  ])('validates what changed: %s', (_, over) => {
    expect(() =>
      announcementEditWrites(service, edit({ title: undefined, ...over })),
    ).toThrow(AnnouncementInputError);
  });

  it('carries a condition on the version, so a stale one fails', () => {
    const stale = part(
      announcementEditWrites(service, edit({ version: 1 }))[0],
    );
    const current = part(
      announcementEditWrites(service, edit({ version: 2 }))[0],
    );

    const versionOf = (p: typeof stale) =>
      Object.entries(p.ExpressionAttributeValues).find(([k]) =>
        /^:version\d/.test(k),
      )?.[1];
    expect(versionOf(stale)).toBe(1);
    expect(versionOf(current)).toBe(2);
  });

  it('calls no notification helper', () => {
    vi.mocked(notification.notifyCourseStudents).mockClear();

    announcementEditWrites(service, edit());
    announcementDeleteWrites(service, {
      courseId: 'course-1',
      announcementId: ID,
      instructorId: 'instructor-1',
    });

    expect(notification.notifyCourseStudents).not.toHaveBeenCalled();
  });
});

describe('announcementDeleteWrites', () => {
  it('deletes only what exists, with the membership check', () => {
    const [remove, member] = announcementDeleteWrites(service, {
      courseId: 'course-1',
      announcementId: ID,
      instructorId: 'instructor-1',
    }).map(part);

    expect(remove.kind).toBe('Delete');
    expect(remove.Key.sk).toContain(ID);
    expect(remove.ConditionExpression).toContain('attribute_exists');
    expect(member.kind).toBe('ConditionCheck');
    expect(member.Key.sk).toContain('instructor-1');
  });
});

describe('announcementPage', () => {
  // A fake keyed query over `stored`: the real entity builds the partition
  // key and reads cursors, the fake table pages by ascending key like
  // DynamoDB and honours `order`, `limit` and the cursor.
  const stored = new Map<string, string[]>();
  const keyOf = (courseId: string, id: string) => ({
    pk: `$coretable#courseid_${courseId}`,
    sk: `$announcement_1#announcementid_${id}`,
  });
  const encode = (key: object) =>
    Buffer.from(JSON.stringify(key)).toString('base64url');
  const decode = (cursor: string) =>
    JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  const fakeService = (go?: (...args: any[]) => unknown) => {
    const { announcement } = service.entities;
    const table = async ({ courseId }: { courseId: string }, options: any) => {
      const ids = [...(stored.get(courseId) ?? [])].sort();
      if (options.order === 'desc') ids.reverse();
      const start = options.cursor
        ? ids.findIndex(
            (id) => keyOf(courseId, id).sk === decode(options.cursor).sk,
          ) + 1
        : 0;
      const data = ids
        .slice(start, start + options.limit)
        .map((announcementId) => ({ announcementId }));
      const last = data.at(-1);
      return {
        data,
        cursor:
          last && start + options.limit < ids.length
            ? encode(keyOf(courseId, last.announcementId))
            : null,
      };
    };
    return {
      entities: {
        announcement: {
          query: {
            primary: (key: { courseId: string }) => ({
              params: () => announcement.query.primary(key).params(),
              go: (options: unknown) => (go ?? table)(key, options),
            }),
          },
        },
      },
    } as unknown as CoreTable;
  };
  const ids = (n: number) =>
    Array.from({ length: n }, (_, i) => idAt(minutes(i), i + 1));
  const page = (s: CoreTable, input: Record<string, unknown> = {}) =>
    announcementPage(s, { courseId: 'course-1', ...input } as never);

  it('returns newest first across a page boundary, each once', async () => {
    stored.set('course-1', ids(5));
    const s = fakeService();

    const first = await page(s, { limit: 2 });
    const second = await page(s, { limit: 2, cursor: first.cursor });
    const third = await page(s, { limit: 2, cursor: second.cursor });

    const all = [...first.items, ...second.items, ...third.items].map(
      (i) => i.announcementId,
    );
    expect(all).toEqual([...ids(5)].reverse());
    expect(third.cursor).toBeUndefined();
  });

  it('neither repeats nor skips when one is added between pages', async () => {
    stored.set('course-1', ids(4));
    const s = fakeService();
    const first = await page(s, { limit: 2 });

    stored.set('course-1', [...ids(4), idAt(minutes(10), 99)]);
    const second = await page(s, { limit: 2, cursor: first.cursor });

    // The new one is newer than the first page, so it is on the pages already
    // read, not repeated or squeezed between the remaining ones.
    expect(
      [...first.items, ...second.items].map((i) => i.announcementId),
    ).toEqual([ids(4)[3], ids(4)[2], ids(4)[1], ids(4)[0]]);
  });

  it('asks for 20 newest-first by default and refuses a limit outside 1 to 20', async () => {
    const spy = vi.fn(async () => ({ data: [], cursor: null }));
    const s = fakeService(spy);

    await page(s);

    expect(spy).toHaveBeenCalledWith(
      { courseId: 'course-1' },
      {
        order: 'desc',
        limit: 20,
        cursor: undefined,
      },
    );
    await expect(page(s, { limit: 0 })).rejects.toThrow(AnnouncementInputError);
    await expect(page(s, { limit: 21 })).rejects.toThrow(
      AnnouncementInputError,
    );
  });

  it("refuses another course's cursor and accepts its own", async () => {
    const cursorOf = (courseId: string) => encode(keyOf(courseId, ID));
    const spy = vi.fn(async () => ({ data: [], cursor: null }));
    const s = fakeService(spy);

    await expect(page(s, { cursor: cursorOf('course-2') })).rejects.toThrow(
      AnnouncementInputError,
    );
    await expect(page(s, { cursor: 'garbage' })).rejects.toThrow(
      AnnouncementInputError,
    );
    expect(spy).not.toHaveBeenCalled();
    await expect(page(s, { cursor: cursorOf('course-1') })).resolves.toEqual({
      items: [],
      cursor: undefined,
    });
  });
});
