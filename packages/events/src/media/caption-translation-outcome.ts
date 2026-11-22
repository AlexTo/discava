/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import type { Logger } from '@aws-lambda-powertools/logger';
import { type Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { resolveCaptionTranslationSettings } from '@discava/common-server-utils/caption-translation-settings';
import {
  captionKey,
  isWebVtt,
  previewCaptionKey,
} from '@discava/common-server-utils/captions';
import { resolveLessonMediaBucketName } from '@discava/common-server-utils/lesson-media-bucket';
import { s3ClientConfig } from '@discava/common-server-utils/local-dev';
import {
  manifestNonce,
  previewManifestNonce,
} from '@discava/common-server-utils/media-keys';
import {
  cueText,
  parseWebVtt,
  serialiseWebVtt,
} from '@discava/common-server-utils/webvtt';
import { captionNativeLabel } from '@discava/common-web-utils/caption-languages';
import {
  applyCaptionChange,
  type CaptionTargetKey,
  type CaptionTrack,
  CaptionTrackError,
  getCaptionRecord,
  isConditionalCheckFailed,
  isPreviewKey,
  planCaptionTranslations,
  writeCaptionTranslationOutcome,
  writeTranslatedCaptionTracks,
} from '@discava/core-table';
import { getCoreTable } from './transcode-outcome.js';
import {
  translateTexts,
  UnsupportedLanguageError,
} from './translate-client.js';

// Translating a video's default caption track into its course's caption
// languages. Safe to run twice and out of order (research R-6): the run reads
// only the record's key, then the record and course as they are now, and
// plans from that, so a duplicate finds every language already translated from
// the current source and does nothing, and an older change handled after a
// newer one computes the same plan. Every write is conditioned on the
// record still playing the version (nonce) the run read and on the track
// list's revision; a result for a replaced or deleted video is dropped and its
// file deleted. A file is put before the track naming it is written, so a
// track never points at nothing.

/** A source with more caption text than this is not translated. */
export const TRANSLATION_MAX_CHARACTERS = 300_000;
/** A language is not started with less of the run than this left. */
export const MIN_REMAINING_MS = 120_000;

// S3Mock in local dev (#137).
const s3Client = new S3Client(s3ClientConfig());

type Failure = { language: string; reason: 'failed' | 'too-long' };

type Record_ = NonNullable<Awaited<ReturnType<typeof getCaptionRecord>>> & {
  type?: string;
  captionTranslation?: { sourceTrackId: string; failures: Failure[] };
};

interface State {
  item: Record_;
  nonce: string;
  rev: number;
  captionLanguages: string[] | undefined;
  plan: ReturnType<typeof planCaptionTranslations>;
}

const failureKey = ({ language, reason }: Failure) => `${language}:${reason}`;

const emit = (
  metrics: Metrics,
  language: string,
  name: string,
  value: number,
) => {
  const metric = metrics.singleMetric();
  metric.addDimension('TargetLanguage', language);
  metric.addMetric(name, MetricUnit.Count, value);
};

/**
 * Brings a video's translated tracks in line with its course's caption
 * languages (steps 1 to 7 of the handler contract). Records what couldn't be
 * done; throws, after writing the rest, when a retry could help.
 */
export const translateVideoCaptions = async (
  logger: Logger,
  metrics: Metrics,
  key: CaptionTargetKey,
  { remainingMs }: { remainingMs: number },
): Promise<void> => {
  const deadline = Date.now() + remainingMs;
  const { entities } = await getCoreTable();
  const isPreview = isPreviewKey(key);
  const context = { ...key };

  const load = async (): Promise<State | undefined> => {
    const item = (await getCaptionRecord(entities, key)) as
      | Record_
      | null
      | undefined;
    if (
      !item ||
      item.status !== 'ready' ||
      (!isPreview && item.type !== 'video')
    ) {
      return undefined;
    }
    const nonce = (isPreview ? previewManifestNonce : manifestNonce)(
      item.s3Key ?? '',
    );
    const course = (await entities.course.get({ courseId: key.courseId }).go())
      .data;
    if (!nonce || !course) {
      return undefined;
    }
    const captionLanguages = course.captionLanguages ?? undefined;
    return {
      item,
      nonce,
      rev: item.captionTracksRev ?? 0,
      captionLanguages,
      plan: planCaptionTranslations(item.captionTracks, {
        nonce,
        captionLanguages,
        courseLanguage: course.language ?? undefined,
        settings: await resolveCaptionTranslationSettings(),
      }),
    };
  };

  const bucket = await resolveLessonMediaBucketName();
  const deleteFile = async (fileKey: string) => {
    try {
      await s3Client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: fileKey }),
      );
    } catch (error) {
      logger.error('Failed to delete a caption file', {
        error,
        key: fileKey,
        ...context,
      });
    }
  };

  // One conditional write of the track list `change` computes from a fresh
  // read, tried twice when the condition is lost. `gone` is a record that
  // is deleted, replaced or not ready; `dropped` a change with nothing to do.
  const commit = async (
    change: (state: State) => { tracks: CaptionTrack[] } | undefined,
  ): Promise<'written' | 'gone' | 'dropped' | 'lost'> => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const state = await load();
      if (!state) {
        return 'gone';
      }
      const result = change(state);
      if (!result) {
        return 'dropped';
      }
      try {
        await writeTranslatedCaptionTracks(entities, key, {
          tracks: result.tracks,
          rev: state.rev,
          nonce: state.nonce,
        });
        return 'written';
      } catch (error) {
        if (!isConditionalCheckFailed(error)) {
          throw error;
        }
        logger.info('Captions changed meanwhile', { attempt, ...context });
      }
    }
    return 'lost';
  };

  const first = await load();
  if (!first) {
    logger.info(
      'Video is gone, replaced or not ready; nothing to translate',
      context,
    );
    return;
  }
  const { sourceTrack } = first.plan;

  // 3. Tracks no longer wanted.
  if (first.plan.remove.length > 0) {
    const removedFiles: string[] = [];
    await commit((state) => {
      removedFiles.length = 0;
      let tracks = state.item.captionTracks ?? [];
      for (const track of state.plan.remove) {
        const result = applyCaptionChange(
          tracks,
          { type: 'remove', nonce: state.nonce, trackId: track.trackId },
          {
            currentNonce: state.nonce,
            captionLanguages: state.captionLanguages,
          },
        );
        tracks = result.tracks;
        if (result.removed) {
          removedFiles.push(result.removed.key);
        }
      }
      return removedFiles.length > 0 ? { tracks } : undefined;
    }).then((outcome) =>
      outcome === 'written' ? Promise.all(removedFiles.map(deleteFile)) : [],
    );
  }

  const staleOutcome =
    first.item.captionTranslation &&
    first.item.captionTranslation.sourceTrackId === sourceTrack?.trackId
      ? first.item.captionTranslation.failures
      : [];
  const recordOutcome = async (failures: Failure[]) => {
    if (!sourceTrack) {
      return;
    }
    const before = new Set(staleOutcome.map(failureKey));
    const after = new Set(failures.map(failureKey));
    if (
      before.size === after.size &&
      [...before].every((entry) => after.has(entry)) &&
      (failures.length > 0 || !first.item.captionTranslation)
    ) {
      return;
    }
    try {
      await writeCaptionTranslationOutcome(entities, key, {
        nonce: first.nonce,
        sourceTrackId: sourceTrack.trackId,
        failures,
      });
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }
      logger.info('Video changed before the outcome was recorded', context);
    }
  };

  // 4. Nothing to make: a recorded outcome is stale.
  const languages = first.plan.translate;
  if (languages.length === 0 || !sourceTrack) {
    if (first.item.captionTranslation) {
      await recordOutcome([]);
    }
    return;
  }

  // 5. The source's cues.
  const { Body } = await s3Client.send(
    new GetObjectCommand({ Bucket: bucket, Key: sourceTrack.key }),
  );
  const source = (await Body?.transformToString()) ?? '';
  let cues: ReturnType<typeof parseWebVtt>['cues'];
  try {
    cues = parseWebVtt(source).cues;
  } catch (error) {
    logger.error('The source captions are not a WebVTT file', {
      error,
      ...context,
    });
    for (const language of languages) {
      emit(metrics, language, 'TranslationFailures', 1);
    }
    await recordOutcome(
      languages.map((language) => ({ language, reason: 'failed' })),
    );
    return;
  }
  const texts = cues.map(cueText);
  const total = texts.reduce((sum, text) => sum + [...text].length, 0);
  if (total > TRANSLATION_MAX_CHARACTERS) {
    logger.warn('The captions are too long to translate', {
      characters: total,
      ...context,
    });
    for (const language of languages) {
      emit(metrics, language, 'TranslationFailures', 1);
    }
    await recordOutcome(
      languages.map((language) => ({ language, reason: 'too-long' })),
    );
    return;
  }

  // 6. One language at a time, in the course's order.
  const failures: Failure[] = [];
  const retryable: string[] = [];
  for (const language of languages) {
    if (deadline - Date.now() < MIN_REMAINING_MS) {
      retryable.push(language);
      const previous = staleOutcome.find((f) => f.language === language);
      if (previous) {
        failures.push(previous);
      }
      continue;
    }
    try {
      const result = await translateTexts({
        texts,
        sourceLanguage: sourceTrack.language,
        targetLanguage: language,
      });
      const vtt = serialiseWebVtt(
        cues.map((cue, i) => ({
          ...(cue.id !== undefined ? { id: cue.id } : {}),
          timing: cue.timing,
          text: result.texts[i] ?? '',
        })),
      );
      const check = parseWebVtt(vtt).cues;
      if (
        check.length !== cues.length ||
        check.some((cue, i) => cue.timing !== cues[i].timing) ||
        !isWebVtt(new TextEncoder().encode(vtt))
      ) {
        throw new Error('The translated captions do not match the source');
      }
      const trackId = randomUUID();
      const fileKey = isPreviewKey(key)
        ? previewCaptionKey(key.courseId, first.nonce, trackId)
        : captionKey(key, first.nonce, trackId);
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: fileKey,
          Body: vtt,
          ContentType: 'text/vtt',
        }),
      );
      let replacedKey: string | undefined;
      let outcome: Awaited<ReturnType<typeof commit>>;
      try {
        outcome = await commit((state) => {
          replacedKey = undefined;
          if (
            state.nonce !== first.nonce ||
            state.plan.sourceTrack?.trackId !== sourceTrack.trackId ||
            !state.plan.translate.includes(language)
          ) {
            return undefined;
          }
          try {
            const change = applyCaptionChange(
              state.item.captionTracks,
              {
                type: 'add',
                nonce: state.nonce,
                track: {
                  trackId,
                  nonce: state.nonce,
                  language,
                  label: captionNativeLabel(language),
                  source: 'translated',
                  sourceTrackId: sourceTrack.trackId,
                  key: fileKey,
                },
              },
              {
                currentNonce: state.nonce,
                captionLanguages: state.captionLanguages,
              },
            );
            if (change.dropped) {
              return undefined;
            }
            replacedKey = change.replaced?.key;
            return { tracks: change.tracks };
          } catch (error) {
            if (error instanceof CaptionTrackError) {
              return undefined;
            }
            throw error;
          }
        });
      } catch (error) {
        await deleteFile(fileKey);
        throw error;
      }
      if (outcome !== 'written') {
        await deleteFile(fileKey);
        logger.info('Dropped a translation that no longer applies', {
          language,
          outcome,
          ...context,
        });
        if (outcome === 'lost') {
          retryable.push(language);
        }
        continue;
      }
      if (replacedKey) {
        await deleteFile(replacedKey);
      }
      emit(metrics, language, 'TranslatedCharacters', result.characters);
      emit(metrics, language, 'TranslatedTracks', 1);
      if (result.fallbacks > 0) {
        emit(metrics, language, 'ChunkFallbacks', result.fallbacks);
      }
      logger.info('Wrote a translated caption track', {
        key: fileKey,
        language,
        characters: result.characters,
        requests: result.requests,
        fallbacks: result.fallbacks,
        ...context,
      });
    } catch (error) {
      emit(metrics, language, 'TranslationFailures', 1);
      failures.push({ language, reason: 'failed' });
      if (error instanceof UnsupportedLanguageError) {
        logger.warn('Amazon Translate cannot make this language', {
          error,
          language,
          ...context,
        });
      } else {
        logger.error('Failed to translate the captions', {
          error,
          language,
          ...context,
        });
        retryable.push(language);
      }
    }
  }

  // 7. What could not be done, then a retry for what a retry can help.
  await recordOutcome(failures);
  if (retryable.length > 0) {
    throw new Error(
      `Captions not translated into ${retryable.join(', ')}; retrying`,
    );
  }
};
