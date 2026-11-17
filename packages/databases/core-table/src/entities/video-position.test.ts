/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createVideoPositionEntity } from './video-position.js';

// The requests ElectroDB would send, checked without a table.

let videoPosition: Awaited<ReturnType<typeof createVideoPositionEntity>>;
beforeAll(async () => {
  process.env.LOCAL_DEV = 'true';
  videoPosition = await createVideoPositionEntity();
});

const key = {
  userId: 'user-1',
  courseId: 'course-1',
  lessonId: 'lesson-1',
  contentItemId: 'item-1',
};
const record = {
  ...key,
  moduleId: 'module-1',
  positionSeconds: 42,
  versionId: 'nonce-1',
  savedAt: '2026-11-16T00:00:00.000Z',
};

describe('videoPosition key', () => {
  it('is the user, then the item place', () => {
    const { Item } = videoPosition.put(record).params() as {
      Item: Record<string, unknown>;
    };

    expect(Item.pk).toContain('user-1');
    expect(Item.sk).toContain('course-1');
    expect(Item.sk).toContain('lesson-1');
    expect(Item.sk).toContain('item-1');
    expect(Item.sk).not.toContain('module-1');
  });

  it('is read with one get', () => {
    const params = videoPosition.get(key).params() as {
      Key: Record<string, unknown>;
    };

    expect(Object.keys(params.Key).sort()).toEqual(['pk', 'sk']);
  });
});

describe('videoPosition attributes', () => {
  it.each(['moduleId', 'positionSeconds', 'versionId', 'savedAt'])(
    'is refused without %s',
    (field) => {
      const { [field as keyof typeof record]: _, ...rest } = record;
      expect(() => videoPosition.put(rest as never).params()).toThrow();
    },
  );
});
