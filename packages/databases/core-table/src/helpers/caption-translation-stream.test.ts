/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { matchesCaptionTranslationStreamFilters } from './caption-translation-stream.js';

type Attr = Record<string, unknown>;
const track = (
  trackId: string,
  language: string,
  source: string,
  isDefault = false,
) => ({
  M: {
    trackId: { S: trackId },
    language: { S: language },
    source: { S: source },
    isDefault: { BOOL: isDefault },
    label: { S: language },
  },
});
const change = (
  entity: string,
  oldAttrs: Attr,
  newAttrs: Attr,
  eventName = 'MODIFY',
) => ({
  eventName,
  dynamodb: {
    OldImage: { __edb_e__: { S: entity }, ...oldAttrs },
    NewImage: { __edb_e__: { S: entity }, ...newAttrs },
  },
});
const tracks = (...items: unknown[]) => ({ captionTracks: { L: items } });

const auto = track('t1', 'en-US', 'auto', true);

describe.each(['contentItem', 'coursePreview'])('a %s change', (entity) => {
  it('passes a new default track', () => {
    expect(
      matchesCaptionTranslationStreamFilters(
        change(entity, tracks(), tracks(auto)),
      ),
    ).toBe(true);
  });

  it('passes a changed uploaded track', () => {
    expect(
      matchesCaptionTranslationStreamFilters(
        change(
          entity,
          tracks(auto),
          tracks(auto, track('t2', 'es-ES', 'uploaded')),
        ),
      ),
    ).toBe(true);
  });

  it('passes a changed captionTranslationRequestedAt', () => {
    expect(
      matchesCaptionTranslationStreamFilters(
        change(
          entity,
          { ...tracks(auto), captionTranslationRequestedAt: { S: 'a' } },
          { ...tracks(auto), captionTranslationRequestedAt: { S: 'b' } },
        ),
      ),
    ).toBe(true);
  });

  it('ignores a write that only adds or removes a translated track', () => {
    const translated = track('t3', 'fr-FR', 'translated');
    expect(
      matchesCaptionTranslationStreamFilters(
        change(entity, tracks(auto), tracks(auto, translated)),
      ),
    ).toBe(false);
    expect(
      matchesCaptionTranslationStreamFilters(
        change(entity, tracks(auto, translated), tracks(auto)),
      ),
    ).toBe(false);
  });

  it('ignores a title edit, an activity count and a captionTranslation write', () => {
    for (const [o, n] of [
      [{ title: { S: 'a' } }, { title: { S: 'b' } }],
      [
        { studentActivityCount: { N: '1' } },
        { studentActivityCount: { N: '2' } },
      ],
      [{}, { captionTranslation: { M: {} } }],
    ] as const) {
      expect(
        matchesCaptionTranslationStreamFilters(
          change(entity, { ...tracks(auto), ...o }, { ...tracks(auto), ...n }),
        ),
      ).toBe(false);
    }
  });
});

describe('a course change', () => {
  it('passes a changed captionLanguages', () => {
    expect(
      matchesCaptionTranslationStreamFilters(
        change('course', {}, { captionLanguages: { L: [{ S: 'es-ES' }] } }),
      ),
    ).toBe(true);
  });

  it('passes a changed language alone', () => {
    const languages = { captionLanguages: { L: [{ S: 'es-ES' }] } };
    expect(
      matchesCaptionTranslationStreamFilters(
        change(
          'course',
          { ...languages, language: { S: 'en' } },
          { ...languages, language: { S: 'fr' } },
        ),
      ),
    ).toBe(true);
  });

  it('ignores a change that leaves both alone', () => {
    const same = {
      captionLanguages: { L: [{ S: 'es-ES' }] },
      language: { S: 'en' },
    };
    expect(
      matchesCaptionTranslationStreamFilters(
        change(
          'course',
          { ...same, title: { S: 'a' } },
          { ...same, title: { S: 'b' } },
        ),
      ),
    ).toBe(false);
  });
});

describe('other records', () => {
  it('ignores an INSERT and a REMOVE', () => {
    for (const eventName of ['INSERT', 'REMOVE']) {
      expect(
        matchesCaptionTranslationStreamFilters(
          change('contentItem', tracks(), tracks(auto), eventName),
        ),
      ).toBe(false);
    }
  });

  it('ignores a record missing an image', () => {
    expect(
      matchesCaptionTranslationStreamFilters({
        eventName: 'MODIFY',
        dynamodb: { NewImage: { __edb_e__: { S: 'course' } } },
      }),
    ).toBe(false);
    expect(
      matchesCaptionTranslationStreamFilters({ eventName: 'MODIFY' }),
    ).toBe(false);
  });

  it('ignores another entity', () => {
    expect(
      matchesCaptionTranslationStreamFilters(
        change('lesson', { a: { S: '1' } }, { a: { S: '2' } }),
      ),
    ).toBe(false);
  });
});
