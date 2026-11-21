/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Logger } from '@aws-lambda-powertools/logger';
import type { Metrics } from '@aws-lambda-powertools/metrics';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MIN_REMAINING_MS,
  TRANSLATION_MAX_CHARACTERS,
  translateVideoCaptions,
} from './caption-translation-outcome.js';
import { UnsupportedLanguageError } from './translate-client.js';

type Track = {
  trackId: string;
  nonce: string;
  language: string;
  label: string;
  source: 'auto' | 'uploaded' | 'translated';
  key: string;
  isDefault: boolean;
  sourceTrackId?: string;
};

const h = vi.hoisted(() => ({
  db: { item: undefined as Record<string, unknown> | undefined },
  course: { value: undefined as Record<string, unknown> | undefined },
  files: new Map<string, string>(),
  settings: { enabled: true, maxLanguagesPerCourse: 9 },
  translateTexts: vi.fn(),
  loseConditions: { count: 0 },
  outcomeWrites: [] as unknown[],
  trackWrites: [] as unknown[],
  puts: [] as string[],
  beforeWrite: { fn: undefined as undefined | (() => void) },
}));

vi.mock('@discava/core-table', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@discava/core-table')>();
  const conditionalFailure = () =>
    Object.assign(new Error('failed'), {
      cause: Object.assign(new Error('failed'), {
        name: 'ConditionalCheckFailedException',
      }),
    });
  return {
    ...actual,
    createCoreTableService: vi.fn(async () => ({
      entities: {
        course: { get: () => ({ go: async () => ({ data: h.course.value }) }) },
      },
    })),
    getCaptionRecord: vi.fn(async () => h.db.item),
    writeTranslatedCaptionTracks: vi.fn(
      async (
        _e: unknown,
        _k: unknown,
        { tracks, rev, nonce }: { tracks: Track[]; rev: number; nonce: string },
      ) => {
        h.beforeWrite.fn?.();
        const item = h.db.item as { captionTracksRev?: number; s3Key: string };
        if (
          h.loseConditions.count > 0 ||
          (item.captionTracksRev ?? 0) !== rev ||
          !item.s3Key.includes(`/${nonce}/`)
        ) {
          h.loseConditions.count = Math.max(0, h.loseConditions.count - 1);
          throw conditionalFailure();
        }
        h.trackWrites.push({ tracks, rev });
        Object.assign(item, {
          captionTracks: tracks,
          captionTracksRev: rev + 1,
        });
      },
    ),
    writeCaptionTranslationOutcome: vi.fn(
      async (
        _e: unknown,
        _k: unknown,
        outcome: { failures: unknown[]; sourceTrackId: string },
      ) => {
        h.outcomeWrites.push(outcome);
        const item = h.db.item as Record<string, unknown>;
        if (outcome.failures.length === 0) {
          delete item.captionTranslation;
        } else {
          item.captionTranslation = { ...outcome, updatedAt: 'now' };
        }
      },
    ),
  };
});

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function () {
    return {
      send: async (command: { type: string; Key: string; Body?: string }) => {
        if (command.type === 'get') {
          const body = h.files.get(command.Key);
          if (body === undefined) {
            throw new Error('NoSuchKey');
          }
          return { Body: { transformToString: async () => body } };
        }
        if (command.type === 'put') {
          h.puts.push(command.Key);
          h.files.set(command.Key, command.Body ?? '');
        } else {
          h.files.delete(command.Key);
        }
        return {};
      },
    };
  }),
  GetObjectCommand: vi.fn(function (input) {
    return { type: 'get', ...input };
  }),
  PutObjectCommand: vi.fn(function (input) {
    return { type: 'put', ...input };
  }),
  DeleteObjectCommand: vi.fn(function (input) {
    return { type: 'delete', ...input };
  }),
}));

vi.mock('@discava/common-server-utils/lesson-media-bucket', () => ({
  resolveLessonMediaBucketName: vi.fn(async () => 'media-bucket'),
}));
vi.mock('@discava/common-server-utils/caption-translation-settings', () => ({
  resolveCaptionTranslationSettings: vi.fn(async () => h.settings),
}));
vi.mock('./translate-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./translate-client.js')>()),
  translateTexts: h.translateTexts,
}));

const REF = {
  courseId: 'c1',
  moduleId: 'm1',
  lessonId: 'l1',
  contentItemId: 'i1',
};
const NONCE = 'n1';
const SOURCE_KEY = `courses/c1/modules/m1/lessons/l1/content-items/i1/${NONCE}/captions/src.vtt`;
const SOURCE_VTT = `WEBVTT

00:00:00.040 --> 00:00:02.100
Hello and welcome.

intro
00:00:02.200 --> 00:00:04.000 align:start
To the course.
`;

const track = (overrides: Partial<Track> = {}): Track => ({
  trackId: 'src',
  nonce: NONCE,
  language: 'en-US',
  label: 'English',
  source: 'auto',
  key: SOURCE_KEY,
  isDefault: true,
  ...overrides,
});

const metricCalls: { dimension?: string; name: string; value: number }[] = [];
const metrics = {
  singleMetric: () => {
    let dimension: string | undefined;
    return {
      addDimension: (_n: string, value: string) => {
        dimension = value;
      },
      addMetric: (name: string, _u: string, value: number) => {
        metricCalls.push({ dimension, name, value });
      },
    };
  },
} as unknown as Metrics;
const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

const setItem = (overrides: Record<string, unknown> = {}) => {
  h.db.item = {
    status: 'ready',
    type: 'video',
    s3Key: `courses/c1/modules/m1/lessons/l1/content-items/i1/${NONCE}/master.m3u8`,
    captionTracks: [track()],
    captionTracksRev: 1,
    captionsStatus: 'ready',
    ...overrides,
  };
};

const run = (remainingMs = 900_000, key: Record<string, string> = REF) =>
  translateVideoCaptions(logger, metrics, key as never, { remainingMs });

const tracksOf = () =>
  (h.db.item?.captionTracks as Track[]).filter(
    (t) => t.source === 'translated',
  );
const upper = async ({
  texts,
  targetLanguage,
}: {
  texts: string[];
  targetLanguage: string;
}) => ({
  texts: texts.map((t) => `[${targetLanguage}] ${t}`),
  characters: texts.join('').length,
  requests: 1,
  fallbacks: 0,
});

beforeEach(() => {
  h.files.clear();
  h.files.set(SOURCE_KEY, SOURCE_VTT);
  h.puts.length = 0;
  h.trackWrites.length = 0;
  h.outcomeWrites.length = 0;
  h.loseConditions.count = 0;
  h.beforeWrite.fn = undefined;
  h.settings = { enabled: true, maxLanguagesPerCourse: 9 };
  h.course.value = {
    courseId: 'c1',
    language: 'en',
    captionLanguages: ['es-ES', 'fr-FR'],
  };
  metricCalls.length = 0;
  h.translateTexts.mockReset().mockImplementation(upper);
  setItem();
});

describe('translateVideoCaptions', () => {
  it('writes one translated track per planned language', async () => {
    await run();
    const tracks = tracksOf();
    expect(
      tracks.map((t) => [t.language, t.label, t.isDefault, t.sourceTrackId]),
    ).toEqual([
      ['es-ES', 'Español', false, 'src'],
      ['fr-FR', 'Français', false, 'src'],
    ]);
    const file = h.files.get(tracks[0].key) ?? '';
    expect(tracks[0].key).toMatch(/\/n1\/captions\/.+\.vtt$/);
    expect(file).toContain('[es-ES] Hello and welcome.');
    expect(file).toContain('intro\n00:00:02.200 --> 00:00:04.000 align:start');
    expect(file).toContain('00:00:00.040 --> 00:00:02.100');
    expect(h.translateTexts.mock.calls[0][0]).toEqual({
      texts: ['Hello and welcome.', 'To the course.'],
      sourceLanguage: 'en-US',
      targetLanguage: 'es-ES',
    });
  });

  it('puts the file before it writes the track', async () => {
    h.beforeWrite.fn = () => {
      expect(h.puts.length).toBeGreaterThan(h.trackWrites.length);
    };
    await run();
    expect(h.trackWrites).toHaveLength(2);
  });

  it('translates only the missing language, and nothing on a second run', async () => {
    await run();
    h.translateTexts.mockClear();
    await run();
    expect(h.translateTexts).not.toHaveBeenCalled();
    h.course.value = {
      ...h.course.value,
      captionLanguages: ['es-ES', 'fr-FR', 'de-DE'],
    };
    await run();
    expect(h.translateTexts).toHaveBeenCalledTimes(1);
    expect(h.translateTexts.mock.calls[0][0].targetLanguage).toBe('de-DE');
    expect(tracksOf()).toHaveLength(3);
  });

  it('translates nothing and removes nothing with translation off', async () => {
    await run();
    h.settings = { enabled: false, maxLanguagesPerCourse: 0 };
    h.translateTexts.mockClear();
    h.course.value = { ...h.course.value, captionLanguages: [] };
    await run();
    expect(h.translateTexts).not.toHaveBeenCalled();
    expect(tracksOf()).toHaveLength(2);
  });

  it('skips a language an uploaded track holds', async () => {
    setItem({
      captionTracks: [
        track(),
        track({
          trackId: 'up',
          language: 'es-ES',
          label: 'Español',
          source: 'uploaded',
          isDefault: false,
          key: 'up.vtt',
        }),
      ],
    });
    await run();
    expect(tracksOf().map((t) => t.language)).toEqual(['fr-FR']);
    expect(h.translateTexts).toHaveBeenCalledTimes(1);
  });

  it('removes the tracks of a dropped language and deletes their files', async () => {
    await run();
    const [spanish] = tracksOf();
    h.course.value = { ...h.course.value, captionLanguages: ['fr-FR'] };
    await run();
    expect(tracksOf().map((t) => t.language)).toEqual(['fr-FR']);
    expect(h.files.has(spanish.key)).toBe(false);
  });

  it('records too-long for each language without throwing', async () => {
    h.files.set(
      SOURCE_KEY,
      `WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n${'x'.repeat(TRANSLATION_MAX_CHARACTERS + 1)}\n`,
    );
    await expect(run()).resolves.toBeUndefined();
    expect(h.translateTexts).not.toHaveBeenCalled();
    expect(h.outcomeWrites).toEqual([
      {
        nonce: NONCE,
        sourceTrackId: 'src',
        failures: [
          { language: 'es-ES', reason: 'too-long' },
          { language: 'fr-FR', reason: 'too-long' },
        ],
      },
    ]);
  });

  it('records failed for an unsupported language, writes the others, and does not throw', async () => {
    h.translateTexts.mockImplementation(
      async (input: { targetLanguage: string; texts: string[] }) => {
        if (input.targetLanguage === 'es-ES') {
          throw new UnsupportedLanguageError('no');
        }
        return upper(input);
      },
    );
    await expect(run()).resolves.toBeUndefined();
    expect(tracksOf().map((t) => t.language)).toEqual(['fr-FR']);
    expect(h.outcomeWrites).toEqual([
      {
        nonce: NONCE,
        sourceTrackId: 'src',
        failures: [{ language: 'es-ES', reason: 'failed' }],
      },
    ]);
  });

  it('records a service failure, writes the others, then throws; a second run recovers', async () => {
    h.translateTexts.mockImplementation(
      async (input: { targetLanguage: string; texts: string[] }) => {
        if (input.targetLanguage === 'es-ES') {
          throw new Error('throttled');
        }
        return upper(input);
      },
    );
    await expect(run()).rejects.toThrow(/es-ES/);
    expect(tracksOf().map((t) => t.language)).toEqual(['fr-FR']);
    expect(h.db.item?.captionTranslation).toBeDefined();

    h.translateTexts.mockImplementation(upper);
    await run();
    expect(
      tracksOf()
        .map((t) => t.language)
        .sort(),
    ).toEqual(['es-ES', 'fr-FR']);
    expect(h.db.item?.captionTranslation).toBeUndefined();
  });

  it.each([
    [
      'is gone',
      () => {
        h.db.item = undefined;
      },
    ],
    ['is not ready', () => setItem({ status: 'processing' })],
    [
      'has no course',
      () => {
        h.course.value = undefined;
      },
    ],
  ])('leaves a record that %s alone', async (_n, arrange) => {
    arrange();
    await run();
    expect(h.puts).toEqual([]);
    expect(h.translateTexts).not.toHaveBeenCalled();
  });

  it('drops a result for a version replaced during the run and deletes its file', async () => {
    h.translateTexts.mockImplementation(
      async (input: { targetLanguage: string; texts: string[] }) => {
        setItem({
          s3Key:
            'courses/c1/modules/m1/lessons/l1/content-items/i1/other/master.m3u8',
          captionTracks: [],
        });
        return upper(input);
      },
    );
    await run();
    expect(h.puts).toHaveLength(2);
    expect([...h.files.keys()]).toEqual([SOURCE_KEY]);
    expect(h.trackWrites).toEqual([]);
  });

  it('ends in the same tracks for a duplicate and for a reordered delivery', async () => {
    // An older change handled after a newer one plans from the record as it
    // is now, so any number of runs, in any order, agree.
    await run();
    const once = JSON.stringify(h.db.item?.captionTracks);
    await run();
    await run();
    expect(JSON.stringify(h.db.item?.captionTracks)).toBe(once);
    expect(h.translateTexts).toHaveBeenCalledTimes(2);
  });

  it('retries a lost condition once from a fresh read', async () => {
    h.loseConditions.count = 1;
    await run();
    expect(tracksOf()).toHaveLength(2);
  });

  it('deletes the file when the condition is lost twice, then throws', async () => {
    h.loseConditions.count = 2;
    await expect(run()).rejects.toThrow();
    expect(tracksOf().map((t) => t.language)).toEqual(['fr-FR']);
    expect([...h.files.keys()].filter((k) => k !== SOURCE_KEY)).toHaveLength(1);
  });

  it('starts no language with too little of the run left, and throws', async () => {
    await expect(run(MIN_REMAINING_MS - 1)).rejects.toThrow();
    expect(h.translateTexts).not.toHaveBeenCalled();
    expect(h.puts).toEqual([]);
  });

  it('works the same for a preview key', async () => {
    const previewSource = 'courses/c1/preview/n1/captions/src.vtt';
    h.files.set(previewSource, SOURCE_VTT);
    h.db.item = {
      status: 'ready',
      s3Key: 'courses/c1/preview/n1/master.m3u8',
      captionTracks: [track({ key: previewSource })],
      captionTracksRev: 0,
    };
    await run(900_000, { courseId: 'c1' });
    const tracks = tracksOf();
    expect(tracks).toHaveLength(2);
    expect(tracks[0].key).toMatch(
      /^courses\/c1\/preview\/n1\/captions\/.+\.vtt$/,
    );
  });

  it('never writes the status, the captioning status or the default track', async () => {
    await run();
    expect(h.db.item?.status).toBe('ready');
    expect(h.db.item?.captionsStatus).toBe('ready');
    const tracks = h.db.item?.captionTracks as Track[];
    expect(tracks.filter((t) => t.isDefault).map((t) => t.trackId)).toEqual([
      'src',
    ]);
  });

  it('emits the cost metrics and a log line, for two tracks written and one failed', async () => {
    h.course.value = {
      ...h.course.value,
      captionLanguages: ['es-ES', 'fr-FR', 'de-DE'],
    };
    h.translateTexts.mockImplementation(
      async (input: { targetLanguage: string; texts: string[] }) => {
        if (input.targetLanguage === 'de-DE') {
          throw new UnsupportedLanguageError('no');
        }
        return {
          ...(await upper(input)),
          fallbacks: input.targetLanguage === 'fr-FR' ? 1 : 0,
        };
      },
    );
    await run();
    const chars = 'Hello and welcome.To the course.'.length;
    expect(metricCalls).toEqual([
      { dimension: 'es-ES', name: 'TranslatedCharacters', value: chars },
      { dimension: 'es-ES', name: 'TranslatedTracks', value: 1 },
      { dimension: 'fr-FR', name: 'TranslatedCharacters', value: chars },
      { dimension: 'fr-FR', name: 'TranslatedTracks', value: 1 },
      { dimension: 'fr-FR', name: 'ChunkFallbacks', value: 1 },
      { dimension: 'de-DE', name: 'TranslationFailures', value: 1 },
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      'Wrote a translated caption track',
      expect.objectContaining({
        courseId: 'c1',
        language: 'es-ES',
        characters: chars,
        requests: 1,
        fallbacks: 0,
      }),
    );
  });
});
