/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { StreamFilter, StreamRecordLike } from './stream-features.js';

/**
 * The records the caption-translation feature reacts to: a change of a video
 * record (content item or course preview) or of a course. The matcher
 * narrows them to the changes that can alter what gets translated.
 */
export const CAPTION_TRANSLATION_STREAM_FILTERS: readonly StreamFilter[] = [
  {
    eventName: 'MODIFY',
    image: 'NewImage',
    entities: ['contentItem', 'coursePreview', 'course'],
  },
];

type Attribute = {
  S?: string;
  BOOL?: boolean;
  L?: Attribute[];
  M?: Record<string, Attribute | undefined>;
} & Record<string, unknown>;
type Image = Record<string, Attribute | undefined>;

// Tracks not made by translation, reduced to what decides translating. A
// translated track is written by the feature itself.
const sourceTracks = (image: Image): string =>
  JSON.stringify(
    (image.captionTracks?.L ?? [])
      .map((track) => track.M ?? {})
      .filter((track) => track.source?.S !== 'translated')
      .map((track) => [
        track.trackId?.S,
        track.language?.S,
        track.isDefault?.BOOL === true,
      ]),
  );

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Whether a stream record passes: a video whose non-translated tracks or
 * `captionTranslationRequestedAt` changed, or a course whose
 * `captionLanguages` or `language` changed. A record missing either image,
 * an INSERT and a REMOVE never pass.
 */
export const matchesCaptionTranslationStreamFilters = (
  record: StreamRecordLike,
): boolean => {
  if (record.eventName !== 'MODIFY') {
    return false;
  }
  const newImage = record.dynamodb?.NewImage as Image | undefined;
  const oldImage = record.dynamodb?.OldImage as Image | undefined;
  if (!newImage || !oldImage) {
    return false;
  }
  switch (newImage.__edb_e__?.S) {
    case 'contentItem':
    case 'coursePreview':
      return (
        sourceTracks(newImage) !== sourceTracks(oldImage) ||
        !same(
          newImage.captionTranslationRequestedAt,
          oldImage.captionTranslationRequestedAt,
        )
      );
    case 'course':
      return (
        !same(newImage.captionLanguages, oldImage.captionLanguages) ||
        !same(newImage.language, oldImage.language)
      );
    default:
      return false;
  }
};
