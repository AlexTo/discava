/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  type TranscriptStreamRecord,
  transcriptActionOf,
} from './transcript-actions.js';

const keys = {
  courseId: 'c1',
  moduleId: 'm1',
  lessonId: 'l1',
  contentItemId: 'i1',
};

const video = (overrides: Record<string, unknown> = {}) => ({
  __edb_e__: 'contentItem',
  ...keys,
  type: 'video',
  status: 'ready',
  s3Key: 'courses/c1/content-items/i1/n1/master.m3u8',
  title: 'Intro',
  studentActivityCount: 1,
  ...overrides,
});

const record = (
  eventName: string,
  oldImage?: Record<string, unknown>,
  newImage?: Record<string, unknown>,
): TranscriptStreamRecord => ({
  eventName,
  dynamodb: { OldImage: oldImage, NewImage: newImage },
});

const sync = { type: 'sync-item', key: keys };

describe('transcriptActionOf', () => {
  it('syncs an inserted video that has caption tracks', () => {
    expect(
      transcriptActionOf(
        record('INSERT', undefined, video({ captionTracks: [] })),
      ),
    ).toEqual(sync);
  });

  it('ignores an inserted video without caption tracks, and other inserts', () => {
    expect(
      transcriptActionOf(record('INSERT', undefined, video())),
    ).toBeUndefined();
    expect(
      transcriptActionOf(
        record('INSERT', undefined, video({ type: 'text', captionTracks: [] })),
      ),
    ).toBeUndefined();
  });

  it.each([
    ['captionTracks', [{ trackId: 't1' }], [{ trackId: 't2' }]],
    ['captionTracksRev', 1, 2],
    ['status', 'pending', 'ready'],
    ['s3Key', 'a/n1/master.m3u8', 'a/n2/master.m3u8'],
    ['previousS3Key', undefined, 'a/n1/master.m3u8'],
    ['visibility', undefined, 'hidden'],
    ['archivedAt', undefined, '2026-01-01'],
  ])('syncs a video whose %s changes', (name, before, after) => {
    expect(
      transcriptActionOf(
        record('MODIFY', video({ [name]: before }), video({ [name]: after })),
      ),
    ).toEqual(sync);
  });

  it('syncs a video that becomes hidden', () => {
    expect(
      transcriptActionOf(
        record('MODIFY', video(), video({ visibility: 'hidden' })),
      ),
    ).toEqual(sync);
  });

  it('ignores a change to only a counter or the title', () => {
    expect(
      transcriptActionOf(
        record(
          'MODIFY',
          video(),
          video({ studentActivityCount: 2, title: 'Renamed' }),
        ),
      ),
    ).toBeUndefined();
  });

  it('ignores a MODIFY of an item that is not a video', () => {
    expect(
      transcriptActionOf(
        record(
          'MODIFY',
          video({ type: 'text' }),
          video({ type: 'text', visibility: 'hidden' }),
        ),
      ),
    ).toBeUndefined();
  });

  it('compares nested values by content', () => {
    const tracks = () => [{ trackId: 't1', isDefault: true }];
    expect(
      transcriptActionOf(
        record(
          'MODIFY',
          video({ captionTracks: tracks() }),
          video({ captionTracks: tracks() }),
        ),
      ),
    ).toBeUndefined();
  });

  it('deletes by contentItemId when an item is removed', () => {
    expect(transcriptActionOf(record('REMOVE', video()))).toEqual({
      type: 'delete-by',
      field: 'contentItemId',
      value: 'i1',
    });
  });

  it('has no action for other entities', () => {
    expect(
      transcriptActionOf(
        record('MODIFY', { __edb_e__: 'course' }, { __edb_e__: 'course' }),
      ),
    ).toBeUndefined();
  });

  describe.each([
    ['lesson', { courseId: 'c1', moduleId: 'm1', lessonId: 'l1' }, 'lessonId'],
    ['module', { courseId: 'c1', moduleId: 'm1' }, 'moduleId'],
  ] as const)('a %s', (entity, entityKeys, field) => {
    const parent = (overrides: Record<string, unknown> = {}) => ({
      __edb_e__: entity,
      ...entityKeys,
      title: 'Title',
      order: 1,
      visibility: 'visible',
      ...overrides,
    });
    const syncUnder = { type: 'sync-under', entity, key: entityKeys };

    it('syncs everything under it when hidden, shown, archived or restored', () => {
      const hidden = parent({ visibility: 'hidden' });
      const archived = parent({ archivedAt: '2026-11-01T00:00:00.000Z' });
      expect(transcriptActionOf(record('MODIFY', parent(), hidden))).toEqual(
        syncUnder,
      );
      expect(transcriptActionOf(record('MODIFY', hidden, parent()))).toEqual(
        syncUnder,
      );
      expect(transcriptActionOf(record('MODIFY', parent(), archived))).toEqual(
        syncUnder,
      );
      expect(transcriptActionOf(record('MODIFY', archived, parent()))).toEqual(
        syncUnder,
      );
    });

    it('has no action for a title, order or free-preview change', () => {
      expect(
        transcriptActionOf(
          record(
            'MODIFY',
            parent(),
            parent({ title: 'New', order: 2, freePreview: true }),
          ),
        ),
      ).toBeUndefined();
    });

    it('deletes by its id when removed', () => {
      expect(transcriptActionOf(record('REMOVE', parent()))).toEqual({
        type: 'delete-by',
        field,
        value: (entityKeys as Record<string, string>)[field],
      });
    });

    it('has no action when inserted', () => {
      expect(
        transcriptActionOf(record('INSERT', undefined, parent())),
      ).toBeUndefined();
    });

    it('throws for a record without its keys', () => {
      expect(() =>
        transcriptActionOf(
          record(
            'MODIFY',
            parent(),
            parent({ moduleId: undefined, visibility: 'hidden' }),
          ),
        ),
      ).toThrow('moduleId');
    });
  });

  it.each(['courseId', 'moduleId', 'lessonId', 'contentItemId'])(
    'throws for an item record without %s',
    (name) => {
      expect(() =>
        transcriptActionOf(
          record('MODIFY', video(), video({ [name]: undefined })),
        ),
      ).toThrow(name);
    },
  );
});
