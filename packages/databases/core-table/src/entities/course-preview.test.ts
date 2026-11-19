/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createContentItemEntity } from './content-item.js';
import { createCoursePreviewEntity } from './course-preview.js';

// The requests ElectroDB would send, checked without a table.

let preview: Awaited<ReturnType<typeof createCoursePreviewEntity>>;
let contentItem: Awaited<ReturnType<typeof createContentItemEntity>>;
beforeAll(async () => {
  process.env.LOCAL_DEV = 'true';
  preview = await createCoursePreviewEntity();
  contentItem = await createContentItemEntity();
});

const record = {
  courseId: 'course-1',
  status: 'processing' as const,
  submissionNonce: 'nonce-1',
  durationSeconds: 120,
  uploadedBy: 'instructor-1',
};

describe('coursePreview', () => {
  it('is created with its timestamps', () => {
    const { Item } = preview.create(record).params() as {
      Item: Record<string, unknown>;
    };

    expect(Item).toMatchObject(record);
    expect(Item).toHaveProperty('createdAt');
    expect(Item).toHaveProperty('updatedAt');
  });

  it.each([
    'courseId',
    'status',
    'submissionNonce',
    'durationSeconds',
    'uploadedBy',
  ])('is refused without its %s', (field) => {
    const { [field as keyof typeof record]: _, ...rest } = record;
    expect(() => preview.create(rest as never).params()).toThrow();
  });

  it.each([0, 301, -1, Number.NaN])(
    'is refused with a duration of %s',
    (durationSeconds) => {
      expect(() =>
        preview.create({ ...record, durationSeconds }).params(),
      ).toThrow();
    },
  );

  it.each([1, 300])('takes a duration of %s', (durationSeconds) => {
    expect(() =>
      preview.create({ ...record, durationSeconds }).params(),
    ).not.toThrow();
  });

  it('is refused with an unknown status or failure reason', () => {
    expect(() =>
      preview.create({ ...record, status: 'pending' as never }).params(),
    ).toThrow();
    expect(() =>
      preview.create({ ...record, failureReason: 'boom' as never }).params(),
    ).toThrow();
  });

  it('keeps its caption tracks', () => {
    const track = {
      trackId: 't1',
      nonce: 'nonce-1',
      language: 'en-US',
      label: 'English',
      source: 'auto' as const,
      key: 'k',
      isDefault: true,
    };
    const { Item } = preview
      .create({ ...record, captionTracks: [track], captionTracksRev: 1 })
      .params() as { Item: Record<string, unknown> };

    expect(Item.captionTracks).toEqual([track]);
  });

  it('has one record per course, in the course’s partition', () => {
    const { Key } = preview.get({ courseId: 'course-1' }).params() as {
      Key: { pk: string; sk: string };
    };

    expect(Key.pk).toBe('$coretable#courseid_course-1');
    expect(Key.sk).not.toContain('courseid');
  });

  describe('byTranscodePending', () => {
    const query = (entity: typeof preview | typeof contentItem) =>
      (
        entity.query as unknown as {
          byTranscodePending: (key: object) => {
            params: () => { KeyConditionExpression: string; IndexName: string };
          };
        }
      )
        .byTranscodePending({ transcodePending: 'pending' })
        .params();

    it('is on the same index as lesson videos', () => {
      expect(query(preview).IndexName).toBe(query(contentItem).IndexName);
    });

    it('cannot return a content item, nor the reverse', () => {
      const values = (entity: typeof preview | typeof contentItem) =>
        Object.values(
          (
            entity.query as unknown as {
              byTranscodePending: (key: object) => {
                params: () => {
                  ExpressionAttributeValues: Record<string, string>;
                };
              };
            }
          )
            .byTranscodePending({ transcodePending: 'pending' })
            .params().ExpressionAttributeValues,
        );

      expect(values(preview).join()).toContain('coursepreview');
      expect(values(preview).join()).not.toContain('contentitem');
      expect(values(contentItem).join()).toContain('contentitem');
      expect(values(contentItem).join()).not.toContain('coursepreview');
    });

    it('indexes only a preview with both attributes', () => {
      const indexed = (item: object) =>
        Object.keys(
          (
            preview.create({ ...record, ...item }).params() as {
              Item: Record<string, unknown>;
            }
          ).Item,
        ).includes('gsi1pk');

      expect(indexed({})).toBe(false);
      expect(
        indexed({
          transcodePending: 'pending',
          transcodePendingSince: '2026-01-01T00:00:00.000Z',
        }),
      ).toBe(true);
    });
  });
});
