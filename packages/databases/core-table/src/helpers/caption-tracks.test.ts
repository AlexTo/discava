/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  applyCaptionChange,
  type CaptionTrack,
  CaptionTrackError,
  captionWriteCondition,
  dropOtherVersions,
  MAX_CAPTION_TRACKS,
  reportedCaptionsStatus,
  tracksForPlayback,
} from './caption-tracks';

const NONCE = 'n1';

const track = (
  language: string,
  overrides: Partial<CaptionTrack> = {},
): CaptionTrack => ({
  trackId: `t-${language}`,
  nonce: NONCE,
  language,
  label: language,
  source: 'uploaded',
  key: `folder/${NONCE}/captions/t-${language}.vtt`,
  isDefault: false,
  ...overrides,
});

const add = (
  current: CaptionTrack[],
  added: Omit<CaptionTrack, 'isDefault'>,
  ...rest: [currentNonce?: string]
) =>
  applyCaptionChange(
    current,
    { type: 'add', nonce: added.nonce, track: added },
    { currentNonce: rest.length ? rest[0] : NONCE },
  );

const withoutDefault = ({ isDefault: _, ...rest }: CaptionTrack) => rest;

const defaults = (tracks: CaptionTrack[]) =>
  tracks.filter((t) => t.isDefault).map((t) => t.language);

const catchError = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe('applyCaptionChange: add', () => {
  it('makes the first track the default', () => {
    const { tracks } = add([], withoutDefault(track('es-ES')));
    expect(tracks).toHaveLength(1);
    expect(tracks[0].isDefault).toBe(true);
  });

  it('keeps the default when a second uploaded track is added', () => {
    const current = [track('es-ES', { isDefault: true })];
    const { tracks } = add(current, withoutDefault(track('fr-FR')));
    expect(defaults(tracks)).toEqual(['es-ES']);
    expect(tracks).toHaveLength(2);
  });

  it('makes an auto track the default over an uploaded one', () => {
    const current = [track('es-ES', { isDefault: true })];
    const { tracks } = add(
      current,
      withoutDefault(track('en-US', { source: 'auto' })),
    );
    expect(defaults(tracks)).toEqual(['en-US']);
  });

  it('refuses an eleventh track', () => {
    const languages = Array.from(
      { length: MAX_CAPTION_TRACKS },
      (_, i) => `xx-${i}`,
    );
    const current = languages.map((l, i) => track(l, { isDefault: i === 0 }));
    const error = catchError(() => add(current, withoutDefault(track('yy'))));
    expect(error).toBeInstanceOf(CaptionTrackError);
    expect((error as CaptionTrackError).code).toBe('TOO_MANY_TRACKS');
  });

  it('allows replacing a language when the list is full', () => {
    const languages = Array.from(
      { length: MAX_CAPTION_TRACKS },
      (_, i) => `xx-${i}`,
    );
    const current = languages.map((l, i) => track(l, { isDefault: i === 0 }));
    const { tracks } = add(
      current,
      withoutDefault(track('xx-3', { trackId: 'new' })),
    );
    expect(tracks).toHaveLength(MAX_CAPTION_TRACKS);
  });

  it('replaces the track in the same language and keeps its default flag', () => {
    const current = [
      track('en-US', { source: 'auto', isDefault: true }),
      track('es-ES'),
    ];
    const { tracks, replaced } = add(
      current,
      withoutDefault(track('en-US', { trackId: 'new', source: 'uploaded' })),
    );
    expect(replaced?.trackId).toBe('t-en-US');
    expect(tracks.map((t) => t.trackId)).toEqual(['new', 't-es-ES']);
    expect(tracks[0].source).toBe('uploaded');
    expect(defaults(tracks)).toEqual(['en-US']);
  });

  it('keeps a non-default flag when replacing a non-default track', () => {
    const current = [track('es-ES', { isDefault: true }), track('fr-FR')];
    const { tracks } = add(
      current,
      withoutDefault(track('fr-FR', { trackId: 'new' })),
    );
    expect(defaults(tracks)).toEqual(['es-ES']);
  });

  it('drops a late auto track when an uploaded one holds the language', () => {
    const current = [track('en-US', { isDefault: true })];
    const result = add(
      current,
      withoutDefault(track('en-US', { trackId: 'auto', source: 'auto' })),
    );
    expect(result.dropped).toBe(true);
    expect(result.tracks).toEqual(current);
  });

  it('lets an auto track replace an auto one', () => {
    const current = [track('en-US', { source: 'auto', isDefault: true })];
    const { tracks, dropped } = add(
      current,
      withoutDefault(track('en-US', { trackId: 'again', source: 'auto' })),
    );
    expect(dropped).toBeUndefined();
    expect(tracks.map((t) => t.trackId)).toEqual(['again']);
    expect(defaults(tracks)).toEqual(['en-US']);
  });

  it('refuses a change for a version that is not the current one', () => {
    const error = catchError(() =>
      add([], withoutDefault(track('es-ES', { nonce: 'old' }))),
    );
    expect((error as CaptionTrackError).code).toBe('STALE_VERSION');
    const none = catchError(() =>
      add([], withoutDefault(track('es-ES')), undefined),
    );
    expect((none as CaptionTrackError).code).toBe('STALE_VERSION');
  });

  it('does not mutate its input', () => {
    const current = [track('es-ES', { isDefault: true })];
    const snapshot = structuredClone(current);
    add(current, withoutDefault(track('fr-FR')));
    expect(current).toEqual(snapshot);
  });
});

describe('applyCaptionChange: remove', () => {
  it('removes a non-default track and leaves the default', () => {
    const current = [track('es-ES', { isDefault: true }), track('fr-FR')];
    const { tracks, removed } = applyCaptionChange(
      current,
      { type: 'remove', nonce: NONCE, trackId: 't-fr-FR' },
      { currentNonce: NONCE },
    );
    expect(removed?.language).toBe('fr-FR');
    expect(defaults(tracks)).toEqual(['es-ES']);
  });

  it('promotes the oldest remaining track when the default is removed', () => {
    const current = [
      track('es-ES', { isDefault: true }),
      track('fr-FR'),
      track('de-DE'),
    ];
    const { tracks } = applyCaptionChange(
      current,
      { type: 'remove', nonce: NONCE, trackId: 't-es-ES' },
      { currentNonce: NONCE },
    );
    expect(tracks.map((t) => t.language)).toEqual(['fr-FR', 'de-DE']);
    expect(defaults(tracks)).toEqual(['fr-FR']);
  });

  it('leaves an empty list when the last track goes', () => {
    const { tracks } = applyCaptionChange(
      [track('es-ES', { isDefault: true })],
      { type: 'remove', nonce: NONCE, trackId: 't-es-ES' },
      { currentNonce: NONCE },
    );
    expect(tracks).toEqual([]);
  });

  it('reports nothing removed for an unknown track', () => {
    const current = [track('es-ES', { isDefault: true })];
    const { tracks, removed } = applyCaptionChange(
      current,
      { type: 'remove', nonce: NONCE, trackId: 'nope' },
      { currentNonce: NONCE },
    );
    expect(removed).toBeUndefined();
    expect(tracks).toEqual(current);
  });

  it('refuses a stale version', () => {
    const error = catchError(() =>
      applyCaptionChange(
        [],
        { type: 'remove', nonce: 'old', trackId: 'x' },
        { currentNonce: NONCE },
      ),
    );
    expect((error as CaptionTrackError).code).toBe('STALE_VERSION');
  });
});

describe('dropOtherVersions', () => {
  it('keeps only the tracks of the given nonce', () => {
    const current = [
      track('es-ES', { nonce: 'old', isDefault: true }),
      track('fr-FR', { isDefault: true }),
    ];
    expect(dropOtherVersions(current, NONCE).map((t) => t.language)).toEqual([
      'fr-FR',
    ]);
  });

  it('is empty when none belong to the nonce, and for no tracks', () => {
    expect(
      dropOtherVersions([track('es-ES', { nonce: 'old' })], NONCE),
    ).toEqual([]);
    expect(dropOtherVersions(undefined, NONCE)).toEqual([]);
  });
});

describe('captionWriteCondition', () => {
  // Renders the where() callback as a string, with attr and op proxies.
  const render = (rev: number, nonce: string) => {
    const attr = new Proxy({}, { get: (_, name) => String(name) });
    const op = new Proxy(
      {},
      {
        get:
          (_, name) =>
          (...args: unknown[]) =>
            `${String(name)}(${args.join(', ')})`,
      },
    );
    return captionWriteCondition(rev, nonce)(attr as never, op as never);
  };

  it('requires the revision to equal the one read and the version current', () => {
    const condition = render(3, 'abc');
    expect(condition).toContain('eq(captionTracksRev, 3)');
    expect(condition).toContain('eq(status, ready)');
    expect(condition).toContain('contains(s3Key, /abc/)');
  });

  it('treats an absent revision as 0', () => {
    expect(render(0, 'abc')).toContain('notExists(captionTracksRev)');
    expect(render(3, 'abc')).not.toContain('notExists');
  });
});

describe('tracksForPlayback', () => {
  it('lists only the played version, the default first', () => {
    const current = [
      track('es-ES'),
      track('fr-FR', { nonce: 'old' }),
      track('en-US', { isDefault: true }),
      track('de-DE'),
    ];
    expect(tracksForPlayback(current, NONCE).map((t) => t.language)).toEqual([
      'en-US',
      'es-ES',
      'de-DE',
    ]);
  });

  it('is empty without tracks', () => {
    expect(tracksForPlayback(undefined, NONCE)).toEqual([]);
  });
});

describe('reportedCaptionsStatus', () => {
  const now = new Date('2026-11-16T12:00:00.000Z');
  const ago = (hours: number) =>
    new Date(now.getTime() - hours * 3_600_000).toISOString();

  it('reports ready and failed as they are', () => {
    expect(reportedCaptionsStatus({ captionsStatus: 'ready' }, now)).toBe(
      'ready',
    );
    expect(reportedCaptionsStatus({ captionsStatus: 'failed' }, now)).toBe(
      'failed',
    );
  });

  it('is undefined when the status is absent', () => {
    expect(reportedCaptionsStatus({}, now)).toBeUndefined();
  });

  it('reports a recent pending as pending', () => {
    expect(
      reportedCaptionsStatus(
        { captionsStatus: 'pending', captionsPendingSince: ago(1.9) },
        now,
      ),
    ).toBe('pending');
  });

  it('reports a pending older than two hours as failed', () => {
    expect(
      reportedCaptionsStatus(
        { captionsStatus: 'pending', captionsPendingSince: ago(2.1) },
        now,
      ),
    ).toBe('failed');
  });
});
