/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  captionLabel,
  captionNativeLabel,
} from '@discava/common-web-utils/caption-languages';
import {
  type CaptionTrack,
  type CaptionTranslationSettings,
  planCaptionTranslations,
} from '@discava/core-table';

export type ReportedCaptionTranslationState =
  | 'translated'
  | 'uploaded'
  | 'translating'
  | 'failed'
  | 'too-long'
  | 'no-room'
  | 'not-translated';

export interface ReportedCaptionTranslation {
  language: string;
  label: string;
  nativeLabel: string;
  state: ReportedCaptionTranslationState;
  reason?: 'no-captions' | 'language-mismatch' | 'disabled';
}

/**
 * What an instructor sees per course caption language: the planner's state
 * combined with the stored outcome. A failure counts only while its
 * `sourceTrackId` is the current default track. Worked out on each read,
 * never stored.
 */
export const reportedCaptionTranslations = (
  record: {
    // The version (manifest nonce) the record plays.
    nonce: string;
    captionTracks?: readonly CaptionTrack[];
    captionTranslation?: {
      sourceTrackId: string;
      failures: readonly { language: string; reason: 'failed' | 'too-long' }[];
    };
  },
  course: { captionLanguages?: readonly string[]; language?: string },
  settings: CaptionTranslationSettings,
): ReportedCaptionTranslation[] => {
  if (!course.captionLanguages?.length) {
    return [];
  }
  const plan = planCaptionTranslations(record.captionTracks, {
    nonce: record.nonce,
    captionLanguages: course.captionLanguages,
    courseLanguage: course.language,
    settings,
  });
  const outcome =
    plan.sourceTrack &&
    record.captionTranslation?.sourceTrackId === plan.sourceTrack.trackId
      ? record.captionTranslation
      : undefined;

  return plan.languages.map((entry) => {
    const names = {
      language: entry.language,
      label: captionLabel(entry.language),
      nativeLabel: captionNativeLabel(entry.language),
    };
    if (entry.state === 'not-translated') {
      return { ...names, state: entry.state, reason: entry.reason };
    }
    if (entry.state !== 'pending') {
      return { ...names, state: entry.state };
    }
    const failure = outcome?.failures.find(
      (f) => f.language === entry.language,
    );
    return { ...names, state: failure ? failure.reason : 'translating' };
  });
};
