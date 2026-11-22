/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICreateContentItemVideoUrlOutput } from '@discava/instructor-api';

export type CaptionTranslation =
  ICreateContentItemVideoUrlOutput['translations'][number];

/** Whether the language still has no track of its own, so a row explains why. */
const hasNoTrack = ({ state }: CaptionTranslation) =>
  state !== 'translated' && state !== 'uploaded';

/** The languages being made or that failed: what "Translate again" is for. */
export const needsRetry = (translations: readonly CaptionTranslation[]) =>
  translations.some(
    ({ state }) => state === 'failed' || state === 'translating',
  );

export const isTranslating = (translations: readonly CaptionTranslation[]) =>
  translations.some(({ state }) => state === 'translating');

const rowText = ({ label, state, reason }: CaptionTranslation): string => {
  switch (state) {
    case 'translating':
      return `${label}: Translating…`;
    case 'failed':
      return `${label}: Translation failed`;
    case 'too-long':
      return `${label}: Captions are too long to translate`;
    case 'no-room':
      return `${label}: No room (10 tracks at most)`;
    case 'not-translated':
      if (reason === 'language-mismatch') {
        return `${label}: The automatic captions aren't in the course's language. Upload captions in the video's language to translate them.`;
      }
      if (reason === 'disabled') {
        return `${label}: Translation isn't available on this site`;
      }
      return `${label}: Needs captions first`;
    default:
      return label;
  }
};

/**
 * One row per course caption language that has no track of its own, saying
 * what became of it. Renders nothing when every language has a track.
 */
export function CaptionTranslationsList({
  translations,
}: {
  translations: readonly CaptionTranslation[];
}) {
  const rows = translations.filter(hasNoTrack);
  if (rows.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="caption-translations-heading">
      <h3 id="caption-translations-heading" className="text-sm font-medium">
        Translations
      </h3>
      <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
        {rows.map((row) => (
          <li key={row.language}>{rowText(row)}</li>
        ))}
      </ul>
    </section>
  );
}
