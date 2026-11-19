/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { type InvariantName } from './index.js';
import type { TableSnapshot } from './snapshot.js';
import {
  checkTableInvariants,
  consistentTable,
  prefix,
  T,
  testHelpers,
} from './test-fixture.js';

let table: TableSnapshot;
beforeEach(() => {
  table = consistentTable();
});
const { item, broken, expectOnly } = testHelpers(() => table);

describe('video-transcode-state', () => {
  it('reports transcodePending without transcodePendingSince', () => {
    Object.assign(item('video'), {
      status: 'pending',
      transcodePending: 'pending',
    });
    expectOnly('video-transcode-state', /not set together/);
  });

  it('reports transcodePending on a video that is no longer pending', () => {
    Object.assign(item('video'), {
      transcodePending: 'pending',
      transcodePendingSince: T,
    });
    expectOnly('video-transcode-state', /on a ready video/);
  });

  it("reports a ready video that doesn't play from a master.m3u8", () => {
    item('video').s3Key = `${prefix}/video/raw.mp4`;
    expectOnly('video-transcode-state', /raw.mp4/);
  });

  it('accepts a pending video with both attributes', () => {
    Object.assign(item('video'), {
      status: 'pending',
      s3Key: undefined,
      transcodePending: 'pending',
      transcodePendingSince: T,
    });
    expect(broken().invariants).toEqual([]);
  });
});

describe('file-item-shape', () => {
  it('reports a file item missing its file', () => {
    item('file').fileSize = undefined;
    expectOnly('file-item-shape', /missing fileSize/);
  });

  it("reports a file outside its version's folder", () => {
    item('file').submissionNonce = 'u2';
    expectOnly('file-item-shape', /isn't in the item's u2 folder/);
  });
});

describe('captions', () => {
  const violationsOf = (invariant: InvariantName) =>
    checkTableInvariants(table).filter((v) => v.invariant === invariant);

  const folder = `${prefix}/video`;
  const track = (language: string, overrides = {}) => ({
    trackId: `t-${language}`,
    nonce: 'n1',
    language,
    label: language,
    source: 'uploaded' as const,
    key: `${folder}/n1/captions/t-${language}.vtt`,
    isDefault: false,
    ...overrides,
  });
  const withTracks = (...tracks: ReturnType<typeof track>[]) => {
    item('video').captionTracks = tracks;
  };

  describe('video-transcode-state, caption attributes', () => {
    it('accepts a ready video with tracks, a status and a revision', () => {
      Object.assign(item('video'), {
        captionTracks: [track('en-US', { isDefault: true })],
        captionTracksRev: 2,
        captionsStatus: 'ready',
      });
      expect(checkTableInvariants(table)).toEqual([]);
    });

    it('accepts a ready video whose captioning is pending', () => {
      Object.assign(item('video'), {
        captionsStatus: 'pending',
        captionsPendingSince: T,
      });
      expect(checkTableInvariants(table)).toEqual([]);
    });

    it('reports a text item holding captionTracks', () => {
      item('text').captionTracks = [track('en-US', { isDefault: true })];
      expect(violationsOf('video-transcode-state')).toHaveLength(1);
      expect(violationsOf('video-transcode-state')[0].message).toMatch(
        /caption attributes are set on a text item/,
      );
    });

    it('reports a pending status on a pending video', () => {
      Object.assign(item('video'), {
        status: 'pending',
        s3Key: undefined,
        transcodePending: 'pending',
        transcodePendingSince: T,
        captionsStatus: 'pending',
        captionsPendingSince: T,
      });
      expect(violationsOf('video-transcode-state')).toEqual([
        expect.objectContaining({
          message: expect.stringMatching(/pending on a pending video/),
        }),
      ]);
    });

    it('reports a pending status without captionsPendingSince', () => {
      item('video').captionsStatus = 'pending';
      expect(violationsOf('video-transcode-state')[0].message).toMatch(
        /without captionsPendingSince/,
      );
    });

    it('reports captionsPendingSince without a pending status', () => {
      Object.assign(item('video'), {
        captionsStatus: 'ready',
        captionsPendingSince: T,
      });
      expect(violationsOf('video-transcode-state')).toHaveLength(1);
    });
  });

  describe('caption-tracks-valid', () => {
    it('accepts a video with no tracks, and a valid list', () => {
      expect(violationsOf('caption-tracks-valid')).toEqual([]);
      withTracks(track('en-US', { isDefault: true }), track('es-ES'));
      expect(violationsOf('caption-tracks-valid')).toEqual([]);
    });

    it('reports eleven tracks', () => {
      withTracks(
        ...Array.from({ length: 11 }, (_, i) =>
          track(`xx-${i}`, { isDefault: i === 0 }),
        ),
      );
      expect(violationsOf('caption-tracks-valid')[0].message).toMatch(
        /11 caption tracks/,
      );
    });

    it('accepts the old version’s tracks while a replacement transcodes', () => {
      withTracks(track('en-US', { isDefault: true }));
      Object.assign(item('video'), {
        status: 'pending',
        s3Key: `${folder}/upload.mp4`,
        previousS3Key: `${folder}/n1/master.m3u8`,
        transcodePending: 'pending',
        transcodePendingSince: T,
      });
      expect(violationsOf('caption-tracks-valid')).toEqual([]);
    });

    it('still reports a track of neither version while one is replaced', () => {
      withTracks(
        track('en-US', {
          isDefault: true,
          nonce: 'older',
          key: `${folder}/older/captions/t.vtt`,
        }),
      );
      Object.assign(item('video'), {
        status: 'pending',
        s3Key: `${folder}/upload.mp4`,
        previousS3Key: `${folder}/n1/master.m3u8`,
        transcodePending: 'pending',
        transcodePendingSince: T,
      });
      expect(violationsOf('caption-tracks-valid')[0].message).toMatch(
        /for version older, not the current n1/,
      );
    });

    it('reports a track whose nonce is not the current one', () => {
      withTracks(
        track('en-US', {
          isDefault: true,
          nonce: 'old',
          key: `${folder}/old/captions/t.vtt`,
        }),
      );
      expect(violationsOf('caption-tracks-valid')[0].message).toMatch(
        /for version old, not the current n1/,
      );
    });

    it('reports two tracks in one language', () => {
      withTracks(
        track('en-US', { isDefault: true }),
        track('en-US', { trackId: 'other' }),
      );
      expect(violationsOf('caption-tracks-valid')[0].message).toMatch(
        /two caption tracks in en-US/,
      );
    });

    it('reports no default, and two defaults', () => {
      withTracks(track('en-US'));
      expect(violationsOf('caption-tracks-valid')[0].message).toMatch(
        /0 default/,
      );
      withTracks(
        track('en-US', { isDefault: true }),
        track('es-ES', { isDefault: true }),
      );
      expect(violationsOf('caption-tracks-valid')[0].message).toMatch(
        /2 default/,
      );
    });

    it('reports a key outside the version’s captions folder', () => {
      withTracks(
        track('en-US', {
          isDefault: true,
          key: `${prefix}/other-item/n1/captions/t.vtt`,
        }),
      );
      expect(violationsOf('caption-tracks-valid')[0].message).toMatch(
        /outside the version's captions folder/,
      );
    });
  });
});

describe('course previews', () => {
  const nonce = 'n1';
  const manifest = `courses/c1/preview/${nonce}/master.m3u8`;
  const preview = (overrides = {}) => ({
    courseId: 'c1',
    status: 'ready' as const,
    s3Key: manifest,
    submissionNonce: nonce,
    durationSeconds: 120,
    ...overrides,
  });
  const track = (language: string, overrides = {}) => ({
    trackId: `t-${language}`,
    nonce,
    language,
    label: language,
    source: 'auto' as const,
    key: `courses/c1/preview/${nonce}/captions/t-${language}.vtt`,
    isDefault: true,
    ...overrides,
  });
  const violationsOf = (invariant: InvariantName) =>
    checkTableInvariants(table).filter((v) => v.invariant === invariant);

  it('accepts a ready preview, one processing, and one that failed', () => {
    table.coursePreviews = [preview()];
    expect(broken().invariants).toEqual([]);
    table.coursePreviews = [
      preview({
        status: 'processing',
        s3Key: undefined,
        previousS3Key: manifest,
        transcodePending: 'pending',
        transcodePendingSince: T,
      }),
    ];
    expect(broken().invariants).toEqual([]);
    table.coursePreviews = [
      preview({
        status: 'failed',
        s3Key: undefined,
        failureReason: 'too-long',
      }),
    ];
    expect(broken().invariants).toEqual([]);
  });

  describe('course-preview-shape', () => {
    it.each([
      ['has no course', { courseId: 'gone' }, /course does not exist/],
      ['is 301 seconds', { durationSeconds: 301 }, /301/],
      ['is 0 seconds', { durationSeconds: 0 }, /not 1 to 300/],
      ['is ready without an s3Key', { s3Key: undefined }, /s3Key is not set/],
      [
        'is ready under another course',
        { s3Key: `courses/c2/preview/${nonce}/master.m3u8` },
        /s3Key/,
      ],
      [
        'is ready under another attempt',
        { s3Key: 'courses/c1/preview/other/master.m3u8' },
        /own/,
      ],
      [
        'is processing with a failureReason',
        { status: 'processing', s3Key: undefined, failureReason: 'too-long' },
        /failureReason is set on a processing/,
      ],
      [
        'failed without a failureReason',
        { status: 'failed', s3Key: undefined },
        /no failureReason/,
      ],
      [
        'keeps a previous version of another course',
        { previousS3Key: 'courses/c2/preview/x/master.m3u8' },
        /previousS3Key/,
      ],
    ])('reports a preview that %s', (_, overrides, message) => {
      table.coursePreviews = [preview(overrides)];
      const found = violationsOf('course-preview-shape');
      expect(found.map((v) => v.message)).toContainEqual(
        expect.stringMatching(message),
      );
    });
  });

  describe('video-transcode-state', () => {
    it('reports transcodePending without its timestamp', () => {
      table.coursePreviews = [
        preview({
          status: 'processing',
          s3Key: undefined,
          transcodePending: 'pending',
        }),
      ];
      expect(violationsOf('video-transcode-state')[0].message).toMatch(
        /not set together/,
      );
    });

    it('reports transcodePending on a ready preview', () => {
      table.coursePreviews = [
        preview({ transcodePending: 'pending', transcodePendingSince: T }),
      ];
      expect(violationsOf('video-transcode-state')[0].message).toMatch(
        /on a ready preview/,
      );
    });

    it('reports a ready preview whose key is not a manifest', () => {
      table.coursePreviews = [
        preview({ s3Key: `courses/c1/preview/${nonce}/x` }),
      ];
      expect(violationsOf('video-transcode-state')[0].message).toMatch(
        /ready preview's s3Key/,
      );
    });

    it('reports captionsStatus pending without its timestamp', () => {
      table.coursePreviews = [preview({ captionsStatus: 'pending' })];
      expect(violationsOf('video-transcode-state')[0].message).toMatch(
        /without captionsPendingSince/,
      );
    });
  });

  describe('caption-tracks-valid', () => {
    it('accepts a track of the played version', () => {
      table.coursePreviews = [preview({ captionTracks: [track('en-US')] })];
      expect(violationsOf('caption-tracks-valid')).toEqual([]);
    });

    it('accepts a preview whose captions are ready with the track', () => {
      table.coursePreviews = [
        preview({ captionsStatus: 'ready', captionTracks: [track('en-US')] }),
      ];
      expect(violationsOf('caption-tracks-valid')).toEqual([]);
    });

    it('reports ready captions with no track for the played version', () => {
      table.coursePreviews = [preview({ captionsStatus: 'ready' })];
      expect(violationsOf('caption-tracks-valid')[0].message).toMatch(
        /ready captions has no track/,
      );
    });

    it('reports a track for a version that is not played', () => {
      table.coursePreviews = [
        preview({
          captionTracks: [
            track('en-US', {
              nonce: 'old',
              key: 'courses/c1/preview/old/captions/t.vtt',
            }),
          ],
        }),
      ];
      expect(violationsOf('caption-tracks-valid')[0].message).toMatch(
        /for version old/,
      );
    });

    it('reports two tracks in one language', () => {
      table.coursePreviews = [
        preview({
          captionTracks: [track('en-US'), track('en-US', { trackId: 'b' })],
        }),
      ];
      expect(
        violationsOf('caption-tracks-valid').map((v) => v.message),
      ).toContainEqual(expect.stringMatching(/two caption tracks/));
    });
  });
});
