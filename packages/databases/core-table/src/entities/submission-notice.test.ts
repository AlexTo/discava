/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createSubmissionNoticeEntity } from './submission-notice.js';

let notice: Awaited<ReturnType<typeof createSubmissionNoticeEntity>>;
beforeAll(async () => {
  notice = await createSubmissionNoticeEntity();
});

const record = {
  courseId: 'course-1',
  contentItemId: 'item-1',
  day: '2026-11-20',
  ttl: 1_795_000_000,
};

describe('submissionNotice', () => {
  it('has one record per assignment and day', () => {
    const { Item } = notice.create(record).params() as {
      Item: Record<string, unknown>;
    };

    expect(Item).toMatchObject(record);
    expect(Item.pk).toContain('item-1');
    expect(Item.sk).toContain('2026-11-20');
  });

  it.each(['day', 'ttl'])('is refused without its %s', (field) => {
    const { [field as keyof typeof record]: _, ...rest } = record;
    expect(() => notice.create(rest as never).params()).toThrow();
  });
});
