/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CaptionTrack } from '@discava/core-table';
import { describe, expect, it } from 'vitest';
import { reportedCaptionTranslations } from './caption-translations.js';

const on = { enabled: true, maxLanguagesPerCourse: 9 };
const nonce = 'n1';
const track = (over: Partial<CaptionTrack>): CaptionTrack => ({
  trackId: 't-en',
  nonce,
  language: 'en-US',
  label: 'English',
  source: 'uploaded',
  key: 'k',
  isDefault: true,
  ...over,
});
const source = track({});
const translated = (language: string, sourceTrackId = 't-en') =>
  track({
    trackId: `t-${language}`,
    language,
    source: 'translated',
    isDefault: false,
    sourceTrackId,
  });

const report = (
  tracks: CaptionTrack[],
  captionLanguages: string[],
  extra: {
    captionTranslation?: Parameters<
      typeof reportedCaptionTranslations
    >[0]['captionTranslation'];
    language?: string;
    settings?: typeof on;
  } = {},
) =>
  reportedCaptionTranslations(
    {
      nonce,
      captionTracks: tracks,
      captionTranslation: extra.captionTranslation,
    },
    { captionLanguages, language: extra.language },
    extra.settings ?? on,
  );

describe('reportedCaptionTranslations', () => {
  it('is empty for a course with no caption languages', () => {
    expect(report([source], [])).toEqual([]);
  });

  it('reports translated, uploaded and translating with names', () => {
    const result = report(
      [
        source,
        translated('es-ES'),
        track({ trackId: 'u', language: 'fr-FR', isDefault: false }),
      ],
      ['es-ES', 'fr-FR', 'de-DE'],
    );
    expect(result.map((r) => [r.language, r.state])).toEqual([
      ['es-ES', 'translated'],
      ['fr-FR', 'uploaded'],
      ['de-DE', 'translating'],
    ]);
    expect(result[0]).toMatchObject({
      label: 'Spanish',
      nativeLabel: 'Español',
    });
  });

  it('reports failed and too-long for the current source only', () => {
    const outcome = {
      sourceTrackId: 't-en',
      failures: [
        { language: 'fr-FR', reason: 'failed' as const },
        { language: 'de-DE', reason: 'too-long' as const },
      ],
    };
    const states = (o: typeof outcome) =>
      report([source], ['fr-FR', 'de-DE', 'es-ES'], {
        captionTranslation: o,
      }).map((r) => r.state);
    expect(states(outcome)).toEqual(['failed', 'too-long', 'translating']);
    expect(states({ ...outcome, sourceTrackId: 'old' })).toEqual([
      'translating',
      'translating',
      'translating',
    ]);
  });

  it('reports no-room when ten tracks are taken', () => {
    const others = Array.from({ length: 9 }, (_, i) =>
      track({
        trackId: `u${i}`,
        language: `x${i}`,
        isDefault: false,
      }),
    );
    expect(report([source, ...others], ['es-ES'])[0]?.state).toBe('no-room');
  });

  it('reports each not-translated reason', () => {
    expect(report([], ['es-ES'])[0]).toMatchObject({
      state: 'not-translated',
      reason: 'no-captions',
    });
    expect(
      report([track({ source: 'auto' })], ['fr-FR'], { language: 'es' })[0],
    ).toMatchObject({ state: 'not-translated', reason: 'language-mismatch' });
    expect(
      report([source], ['es-ES'], {
        settings: { enabled: false, maxLanguagesPerCourse: 0 },
      })[0],
    ).toMatchObject({ state: 'not-translated', reason: 'disabled' });
  });
});
