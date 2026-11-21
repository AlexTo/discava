/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  applyCaptionChange,
  type CaptionTrack,
  CaptionTrackError,
  captionWriteCondition,
  dropOtherVersions,
  getCaptionRecord,
  isPreviewKey,
  MAX_CAPTION_TRACKS,
  planCaptionTranslations,
  reportedCaptionsStatus,
  requestCaptionTranslation,
  tracksForPlayback,
  writeCaptionsFailed,
  writeCaptionsReady,
  writeCaptionTracks,
  writeCaptionTranslationOutcome,
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

  // ElectroDB's where() operations return condition strings and have no
  // and/or: the condition is combined as text.
  it('builds one condition string from ElectroDB-style operations only', () => {
    const attr = { captionTracksRev: 'r', status: 's', s3Key: 'k' };
    const op = {
      eq: (a: string, v: unknown) => `${a} = ${v}`,
      notExists: (a: string) => `attribute_not_exists(${a})`,
      contains: (a: string, v: unknown) => `contains(${a}, ${v})`,
    };
    expect(captionWriteCondition(3, 'abc')(attr, op)).toBe(
      'r = 3 AND s = ready AND contains(k, /abc/)',
    );
    expect(captionWriteCondition(0, 'abc')(attr, op)).toBe(
      '(attribute_not_exists(r) OR r = 0) AND s = ready AND contains(k, /abc/)',
    );
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

describe('target-aware writers', () => {
  const build = () => {
    const calls: { entity: string; ops: [string, unknown][] }[] = [];
    const entity = (name: string) => ({
      get: vi.fn((key) => ({
        go: async () => ({ data: { status: 'ready', key } }),
      })),
      patch: vi.fn((key: unknown) => {
        const call = {
          entity: name,
          ops: [['patch', key]] as [string, unknown][],
        };
        calls.push(call);
        const builder: Record<string, unknown> = {};
        for (const op of ['set', 'remove', 'where']) {
          builder[op] = (arg: unknown) => {
            call.ops.push([op, arg]);
            return builder;
          };
        }
        builder.go = async () => ({});
        return builder;
      }),
    });
    return {
      entities: {
        contentItem: entity('contentItem'),
        coursePreview: entity('coursePreview'),
      },
      calls,
    };
  };
  const item = {
    courseId: 'c',
    moduleId: 'm',
    lessonId: 'l',
    contentItemId: 'i',
  };

  it('tells a preview key from a content item key', () => {
    expect(isPreviewKey({ courseId: 'c' })).toBe(true);
    expect(isPreviewKey(item)).toBe(false);
  });

  it.each([
    ['content item', item, 'contentItem'],
    ['course preview', { courseId: 'c' }, 'coursePreview'],
  ])('patches the matching entity for a %s', async (_n, key, entity) => {
    const { entities, calls } = build();
    await writeCaptionsFailed(entities as never, key, 'n1');
    await writeCaptionsReady(entities as never, key, 'n1');
    await writeCaptionTracks(entities as never, key, {
      tracks: [],
      rev: 2,
      nonce: 'n1',
    });
    expect(calls.map((c) => c.entity)).toEqual([entity, entity, entity]);
    expect(calls.every((c) => c.ops[0][1] === key)).toBe(true);
    const sets = calls.map((c) => c.ops.find(([o]) => o === 'set')?.[1]);
    expect(sets).toEqual([
      { captionsStatus: 'failed' },
      { captionsStatus: 'ready' },
      { captionTracks: [], captionTracksRev: 3, captionsStatus: 'ready' },
    ]);
    expect(calls.every((c) => c.ops.some(([o]) => o === 'where'))).toBe(true);
    expect((await getCaptionRecord(entities as never, key))?.status).toBe(
      'ready',
    );
  });
});

describe('applyCaptionChange: translated tracks', () => {
  const source = track('en-US', {
    trackId: 'src',
    source: 'auto',
    isDefault: true,
  });
  const translated = (
    language: string,
    overrides: Partial<CaptionTrack> = {},
  ) =>
    track(language, {
      source: 'translated',
      sourceTrackId: 'src',
      ...overrides,
    });
  const full = (extra: CaptionTrack[]) => [
    source,
    ...extra,
    ...Array.from({ length: MAX_CAPTION_TRACKS - 1 - extra.length }, (_, i) =>
      track(`xx-${i}`),
    ),
  ];
  const addWith = (
    current: CaptionTrack[],
    added: CaptionTrack,
    captionLanguages?: string[],
  ) =>
    applyCaptionChange(
      current,
      { type: 'add', nonce: NONCE, track: withoutDefault(added) },
      { currentNonce: NONCE, captionLanguages },
    );

  it('appends a translated track that is never the default', () => {
    const { tracks } = addWith([source], translated('es-ES'));
    expect(tracks.map((t) => t.language)).toEqual(['en-US', 'es-ES']);
    expect(defaults(tracks)).toEqual(['en-US']);
  });

  it('drops a translated add when an uploaded track holds the language', () => {
    const current = [source, track('es-ES')];
    const result = addWith(current, translated('es-ES'));
    expect(result.dropped).toBe(true);
    expect(result.tracks).toEqual(current);
  });

  it('drops a translated add when an auto track holds the language', () => {
    const result = addWith([source], translated('en-US', { trackId: 'x' }));
    expect(result.dropped).toBe(true);
    expect(result.tracks).toEqual([source]);
  });

  it("drops a translated add whose source isn't the default track", () => {
    const result = addWith(
      [source],
      translated('es-ES', { sourceTrackId: 'old' }),
    );
    expect(result.dropped).toBe(true);
    expect(result.tracks).toEqual([source]);
  });

  it('drops a translated add when one from the same source holds the language', () => {
    const current = [source, translated('es-ES')];
    const result = addWith(current, translated('es-ES', { trackId: 'again' }));
    expect(result.dropped).toBe(true);
    expect(result.tracks).toEqual(current);
  });

  it('replaces a translated track from an older source', () => {
    const current = [source, translated('es-ES', { sourceTrackId: 'older' })];
    const result = addWith(current, translated('es-ES', { trackId: 'new' }));
    expect(result.dropped).toBeUndefined();
    expect(result.replaced?.sourceTrackId).toBe('older');
    expect(result.tracks.map((t) => t.trackId)).toEqual(['src', 'new']);
  });

  it('drops, rather than throws, when the list has 10 tracks', () => {
    const current = full([]);
    const result = addWith(current, translated('es-ES'));
    expect(result.dropped).toBe(true);
    expect(result.tracks).toHaveLength(MAX_CAPTION_TRACKS);
  });

  it('lets an uploaded add replace a translated track of its language', () => {
    const current = [source, translated('es-ES')];
    const result = addWith(current, track('es-ES', { trackId: 'up' }));
    expect(result.replaced?.source).toBe('translated');
    expect(result.tracks.map((t) => t.trackId)).toEqual(['src', 'up']);
    expect(result.staleTranslated).toBeUndefined();
  });

  it('lets an auto add replace a translated track of its language', () => {
    const current = [
      track('es-ES', { trackId: 'up', isDefault: true }),
      translated('en-US', { sourceTrackId: 'up' }),
    ];
    const result = addWith(
      current,
      track('en-US', { trackId: 'auto', source: 'auto' }),
    );
    expect(result.replaced?.source).toBe('translated');
    expect(defaults(result.tracks)).toEqual(['en-US']);
    expect(result.tracks.some((t) => t.source === 'translated')).toBe(false);
  });

  it('evicts the translated track last in captionLanguages for an upload', () => {
    const current = full([translated('es-ES'), translated('fr-FR')]);
    const result = addWith(current, track('de-DE'), ['fr-FR', 'es-ES']);
    expect(result.evicted?.language).toBe('es-ES');
    expect(result.tracks).toHaveLength(MAX_CAPTION_TRACKS);
    expect(result.tracks.map((t) => t.language)).not.toContain('es-ES');
    expect(result.tracks.at(-1)?.language).toBe('de-DE');
  });

  it('evicts the last added translated track when none is listed', () => {
    const current = full([translated('es-ES'), translated('fr-FR')]);
    const result = addWith(current, track('de-DE'));
    expect(result.evicted?.language).toBe('fr-FR');
  });

  it('still refuses an upload at 10 tracks when none is translated', () => {
    const error = catchError(() => addWith(full([]), track('de-DE')));
    expect((error as CaptionTrackError).code).toBe('TOO_MANY_TRACKS');
  });

  it('returns every translated track as stale when an upload replaces the default', () => {
    const current = [source, translated('es-ES'), translated('fr-FR')];
    const result = addWith(current, track('en-US', { trackId: 'up' }));
    expect(result.staleTranslated?.map((t) => t.language)).toEqual([
      'es-ES',
      'fr-FR',
    ]);
    expect(result.tracks.map((t) => t.trackId)).toEqual(['up']);
    expect(defaults(result.tracks)).toEqual(['en-US']);
  });

  it('returns every translated track as stale when an auto add takes the default', () => {
    const current = [
      track('ja-JP', { trackId: 'up', isDefault: true }),
      translated('es-ES', { sourceTrackId: 'up' }),
    ];
    const result = addWith(
      current,
      track('en-US', { trackId: 'auto', source: 'auto' }),
    );
    expect(result.staleTranslated?.map((t) => t.language)).toEqual(['es-ES']);
    expect(result.tracks.map((t) => t.trackId)).toEqual(['up', 'auto']);
  });

  it('leaves translated tracks alone when the default stays', () => {
    const current = [source, translated('es-ES')];
    const result = addWith(current, track('fr-FR'));
    expect(result.staleTranslated).toBeUndefined();
    expect(result.tracks).toHaveLength(3);
  });

  it('passes the default to the oldest track that is not translated on removal', () => {
    const current = [
      source,
      translated('es-ES'),
      track('fr-FR'),
      track('de-DE'),
    ];
    const result = applyCaptionChange(
      current,
      { type: 'remove', nonce: NONCE, trackId: 'src' },
      { currentNonce: NONCE },
    );
    expect(result.tracks.map((t) => t.language)).toEqual(['fr-FR', 'de-DE']);
    expect(defaults(result.tracks)).toEqual(['fr-FR']);
    expect(result.staleTranslated?.map((t) => t.language)).toEqual(['es-ES']);
  });

  it('empties the list when only translated tracks are left', () => {
    const result = applyCaptionChange(
      [source, translated('es-ES')],
      { type: 'remove', nonce: NONCE, trackId: 'src' },
      { currentNonce: NONCE },
    );
    expect(result.tracks).toEqual([]);
    expect(result.removed?.trackId).toBe('src');
    expect(result.staleTranslated).toHaveLength(1);
  });

  it('removes a translated track without touching the rest', () => {
    const result = applyCaptionChange(
      [source, translated('es-ES')],
      { type: 'remove', nonce: NONCE, trackId: 't-es-ES' },
      { currentNonce: NONCE },
    );
    expect(result.removed?.language).toBe('es-ES');
    expect(result.tracks).toEqual([source]);
    expect(result.staleTranslated).toBeUndefined();
  });

  it('never leaves a translated track as the default', () => {
    const changes = [
      addWith([source], translated('es-ES')),
      addWith([source, translated('es-ES')], track('fr-FR')),
      addWith(full([translated('es-ES')]), track('de-DE')),
    ];
    for (const { tracks } of changes) {
      expect(tracks.some((t) => t.source === 'translated' && t.isDefault)).toBe(
        false,
      );
    }
  });
});

describe('planCaptionTranslations', () => {
  const on = { enabled: true, maxLanguagesPerCourse: 9 };
  const src = track('en-US', {
    trackId: 'src',
    source: 'auto',
    isDefault: true,
  });
  const done = (language: string, sourceTrackId = 'src') =>
    track(language, { source: 'translated', sourceTrackId });
  const plan = (
    tracks: CaptionTrack[],
    captionLanguages: string[] | undefined,
    extra: {
      courseLanguage?: string;
      settings?: typeof on;
      nonce?: string;
    } = {},
  ) =>
    planCaptionTranslations(tracks, {
      nonce: extra.nonce ?? NONCE,
      captionLanguages,
      courseLanguage: extra.courseLanguage,
      settings: extra.settings ?? on,
    });

  it('plans nothing and removes nothing when the stage has translation off', () => {
    const result = plan([src, done('es-ES')], ['es-ES', 'fr-FR'], {
      settings: { ...on, enabled: false },
    });
    expect(result.translate).toEqual([]);
    expect(result.remove).toEqual([]);
    expect(result.languages).toEqual([
      { language: 'es-ES', state: 'not-translated', reason: 'disabled' },
      { language: 'fr-FR', state: 'not-translated', reason: 'disabled' },
    ]);
  });

  it('reports no-captions without a default track', () => {
    const result = plan([], ['es-ES']);
    expect(result.sourceTrack).toBeUndefined();
    expect(result.languages).toEqual([
      { language: 'es-ES', state: 'not-translated', reason: 'no-captions' },
    ]);
    expect(result.translate).toEqual([]);
  });

  it('reports uploaded for an uploaded track and for the source language', () => {
    const result = plan([src, track('es-ES')], ['en-US', 'es-ES']);
    expect(result.languages.map((l) => l.state)).toEqual([
      'uploaded',
      'uploaded',
    ]);
    expect(result.translate).toEqual([]);
  });

  it('reports a mismatch only for an auto source of another language', () => {
    const result = plan([src], ['es-ES'], { courseLanguage: 'es' });
    expect(result.languages).toEqual([
      {
        language: 'es-ES',
        state: 'not-translated',
        reason: 'language-mismatch',
      },
    ]);
    expect(result.translate).toEqual([]);
    const same = plan([src], ['es-ES'], { courseLanguage: 'en' });
    expect(same.translate).toEqual(['es-ES']);
    const unset = plan([src], ['es-ES']);
    expect(unset.translate).toEqual(['es-ES']);
    const uploadedSource = plan(
      [track('en-US', { trackId: 'src', isDefault: true })],
      ['es-ES'],
      { courseLanguage: 'es' },
    );
    expect(uploadedSource.translate).toEqual(['es-ES']);
  });

  it('reports translated for a track made from the current source', () => {
    const result = plan([src, done('es-ES')], ['es-ES']);
    expect(result.languages).toEqual([
      { language: 'es-ES', state: 'translated' },
    ]);
    expect(result.translate).toEqual([]);
    expect(result.remove).toEqual([]);
  });

  it('plans a language whose translated track is from an older source', () => {
    const result = plan([src, done('es-ES', 'older')], ['es-ES']);
    expect(result.translate).toEqual(['es-ES']);
    expect(result.languages[0].state).toBe('pending');
  });

  it('plans pending languages in the course order', () => {
    const result = plan([src], ['fr-FR', 'es-ES', 'de-DE']);
    expect(result.translate).toEqual(['fr-FR', 'es-ES', 'de-DE']);
    expect(result.sourceTrack?.trackId).toBe('src');
  });

  it('gives the places that are left to languages in the course order', () => {
    const uploads = Array.from({ length: 7 }, (_, i) => track(`xx-${i}`));
    const result = plan([src, ...uploads], ['fr-FR', 'es-ES', 'de-DE']);
    expect(result.languages.map((l) => l.state)).toEqual([
      'pending',
      'pending',
      'no-room',
    ]);
    expect(result.translate).toEqual(['fr-FR', 'es-ES']);
    expect(result.remove).toEqual([]);
  });

  it('removes a translated track for a language that is not wanted any more', () => {
    const stale = done('ja-JP');
    const result = plan([src, done('es-ES'), stale], ['es-ES']);
    expect(result.remove).toEqual([stale]);
  });

  it('removes a translated track whose language has no room', () => {
    const uploads = Array.from({ length: 8 }, (_, i) => track(`xx-${i}`));
    const last = done('de-DE');
    const result = plan(
      [src, ...uploads, done('es-ES'), last],
      ['es-ES', 'de-DE'],
    );
    expect(result.languages.map((l) => l.state)).toEqual([
      'translated',
      'no-room',
    ]);
    expect(result.remove).toEqual([last]);
  });

  it('removes translated tracks of a language the source now mismatches', () => {
    const made = done('es-ES');
    const result = plan([src, made], ['es-ES'], { courseLanguage: 'es' });
    expect(result.remove).toEqual([made]);
  });

  it('ignores the tracks of another version', () => {
    const other = track('es-ES', { nonce: 'old' });
    const result = plan([src, other], ['es-ES']);
    expect(result.translate).toEqual(['es-ES']);
    expect(result.remove).toEqual([]);
    const none = plan([src], ['es-ES'], { nonce: 'other' });
    expect(none.sourceTrack).toBeUndefined();
  });

  it('plans nothing for a course without caption languages', () => {
    const stale = done('es-ES');
    const result = plan([src, stale], undefined);
    expect(result.languages).toEqual([]);
    expect(result.remove).toEqual([stale]);
  });
});

describe('caption translation writers', () => {
  const build = () => {
    const calls: { entity: string; ops: [string, unknown][] }[] = [];
    const entity = (name: string) => ({
      patch: vi.fn((key: unknown) => {
        const call = {
          entity: name,
          ops: [['patch', key]] as [string, unknown][],
        };
        calls.push(call);
        const builder: Record<string, unknown> = {};
        for (const op of ['set', 'remove', 'where']) {
          builder[op] = (arg: unknown) => {
            call.ops.push([op, arg]);
            return builder;
          };
        }
        builder.go = async () => ({});
        return builder;
      }),
    });
    return {
      entities: {
        contentItem: entity('contentItem'),
        coursePreview: entity('coursePreview'),
      },
      calls,
    };
  };
  const keys = [
    [
      'content item',
      { courseId: 'c', moduleId: 'm', lessonId: 'l', contentItemId: 'i' },
      'contentItem',
    ],
    ['course preview', { courseId: 'c' }, 'coursePreview'],
  ] as const;
  const ops = {
    eq: (a: unknown, v: unknown) => `${String(a)}=${String(v)}`,
    exists: (a: unknown) => `exists(${String(a)})`,
    notExists: (a: unknown) => `notExists(${String(a)})`,
    contains: (a: unknown, v: unknown) => `contains(${String(a)},${String(v)})`,
  };
  const opOf = (call: { ops: [string, unknown][] }, name: string): unknown =>
    call.ops.find(([o]) => o === name)?.[1];

  it.each(keys)('requests a translation for a %s', async (_n, key, entity) => {
    const { entities, calls } = build();
    await requestCaptionTranslation(entities as never, key);
    expect(calls).toHaveLength(1);
    expect(calls[0].entity).toBe(entity);
    expect(calls[0].ops[0][1]).toBe(key);
    expect(opOf(calls[0], 'set')).toEqual({
      captionTranslationRequestedAt: expect.stringMatching(/^\d{4}-/),
    });
    expect(opOf(calls[0], 'remove')).toEqual(['captionTranslation']);
    const where = opOf(calls[0], 'where') as (a: unknown, o: unknown) => string;
    expect(where({ status: 'status' }, ops)).toBe('exists(status)');
  });

  it('treats a missing record as nothing to request', async () => {
    const { entities } = build();
    const failure = new Error('failed', {
      cause: Object.assign(new Error('x'), {
        name: 'ConditionalCheckFailedException',
      }),
    });
    entities.contentItem.patch.mockImplementation(() => {
      const builder: Record<string, unknown> = {};
      for (const op of ['set', 'remove', 'where']) {
        builder[op] = () => builder;
      }
      builder.go = async () => {
        throw failure;
      };
      return builder as never;
    });
    await expect(
      requestCaptionTranslation(entities as never, keys[0][1]),
    ).resolves.toBeUndefined();
    entities.contentItem.patch.mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(
      requestCaptionTranslation(entities as never, keys[0][1]),
    ).rejects.toThrow('boom');
  });

  it.each(keys)(
    'writes the outcome for a %s, touching nothing else',
    async (_n, key, entity) => {
      const { entities, calls } = build();
      await writeCaptionTranslationOutcome(entities as never, key, {
        nonce: 'n1',
        sourceTrackId: 'src',
        failures: [{ language: 'es-ES', reason: 'failed' }],
      });
      expect(calls[0].entity).toBe(entity);
      expect(opOf(calls[0], 'set')).toEqual({
        captionTranslation: {
          sourceTrackId: 'src',
          failures: [{ language: 'es-ES', reason: 'failed' }],
          updatedAt: expect.stringMatching(/^\d{4}-/),
        },
      });
      expect(opOf(calls[0], 'remove')).toBeUndefined();
      const where = opOf(calls[0], 'where') as (
        a: unknown,
        o: unknown,
      ) => string;
      expect(where({ status: 'status', s3Key: 'key' }, ops)).toBe(
        'status=ready AND contains(key,/n1/)',
      );
    },
  );

  it('removes the outcome when nothing failed', async () => {
    const { entities, calls } = build();
    await writeCaptionTranslationOutcome(entities as never, keys[1][1], {
      nonce: 'n1',
      sourceTrackId: 'src',
      failures: [],
    });
    expect(opOf(calls[0], 'set')).toBeUndefined();
    expect(opOf(calls[0], 'remove')).toEqual(['captionTranslation']);
  });
});
