/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { PREVIEW_MAX_SECONDS } from '../../entities/course-preview.js';
import { MAX_CAPTION_TRACKS } from '../caption-tracks.js';
import { type Check, type Violation, violation } from './common.js';
import type { TableSnapshot } from './snapshot.js';

// The lesson-video rules, for a course's preview: transcodePending and
// transcodePendingSince are set together and only while processing, a ready
// preview plays from a master.m3u8, and captionsStatus: pending needs
// captionsPendingSince and a ready preview.
const checkPreviewTranscodeState = (snapshot: TableSnapshot): Violation[] =>
  snapshot.coursePreviews.flatMap((preview) => {
    const record = { courseId: preview.courseId };
    const problems: string[] = [];
    const pending = preview.transcodePending !== undefined;
    if (pending !== (preview.transcodePendingSince !== undefined)) {
      problems.push(
        'transcodePending and transcodePendingSince are not set together',
      );
    }
    if (pending && preview.status !== 'processing') {
      problems.push(`transcodePending is set on a ${preview.status} preview`);
    }
    // Every coursePreview writer (snapshot.coursePreviews): instructor-api's
    // create and replace set it with the status, so the transcode reconciler
    // can find a preview whose job never reports back.
    if (!pending && preview.status === 'processing') {
      problems.push('a processing preview is not waiting for its transcode');
    }
    if (
      preview.status === 'ready' &&
      !preview.s3Key?.endsWith('/master.m3u8')
    ) {
      problems.push(`a ready preview's s3Key is ${preview.s3Key ?? 'not set'}`);
    }
    if (preview.captionsStatus === 'pending') {
      if (preview.captionsPendingSince === undefined) {
        problems.push('captionsStatus is pending without captionsPendingSince');
      }
      if (preview.status !== 'ready') {
        problems.push(
          `captionsStatus is pending on a ${preview.status} preview`,
        );
      }
    } else if (preview.captionsPendingSince !== undefined) {
      problems.push(
        'captionsPendingSince is set while captions are not pending',
      );
    }
    return problems.map((message) =>
      violation('video-transcode-state', record, message),
    );
  });

// A video's transcode state is consistent: transcodePending and
// transcodePendingSince are set together, and only while it's pending (they
// put it in byTranscodePending); a ready video plays from a master.m3u8.
// Caption attributes appear only on video items, and
// captionsStatus: pending only with captionsPendingSince and only on a ready
// video.
export const checkVideoTranscodeState = (
  snapshot: TableSnapshot,
): Violation[] => [
  ...checkPreviewTranscodeState(snapshot),
  ...snapshot.contentItems.flatMap((item) => {
    const record = {
      courseId: item.courseId,
      contentItemId: item.contentItemId,
    };
    const problems: string[] = [];
    const pending = item.transcodePending !== undefined;
    if (pending !== (item.transcodePendingSince !== undefined)) {
      problems.push(
        'transcodePending and transcodePendingSince are not set together',
      );
    }
    if (pending && (item.type !== 'video' || item.status !== 'pending')) {
      problems.push(
        `transcodePending is set on a ${item.status} ${item.type} item`,
      );
    }
    if (
      item.type === 'video' &&
      item.status === 'ready' &&
      !item.s3Key?.endsWith('/master.m3u8')
    ) {
      problems.push(`a ready video's s3Key is ${item.s3Key ?? 'not set'}`);
    }
    if (
      item.type !== 'video' &&
      (item.captionTracks !== undefined ||
        item.captionTracksRev !== undefined ||
        item.captionsStatus !== undefined ||
        item.captionsPendingSince !== undefined)
    ) {
      problems.push(`caption attributes are set on a ${item.type} item`);
    }
    if (item.captionsStatus === 'pending') {
      if (item.captionsPendingSince === undefined) {
        problems.push('captionsStatus is pending without captionsPendingSince');
      }
      if (item.type === 'video' && item.status !== 'ready') {
        problems.push(`captionsStatus is pending on a ${item.status} video`);
      }
    } else if (item.captionsPendingSince !== undefined) {
      problems.push(
        'captionsPendingSince is set while captions are not pending',
      );
    }
    return problems.map((message) =>
      violation('video-transcode-state', record, message),
    );
  }),
];

// 24 (captions). A video's caption tracks are valid: at most 10, one per
// language, exactly one default when there are any, each of the item's
// played version (the version swap drops every other nonce in the same patch
// that sets status: ready), and each file under that version's captions
// folder.
// The caption-track problems of one video, whose played version is `manifest`
// (a lesson video's .../content-items/<id>/<nonce>/master.m3u8 or a preview's
// courses/<id>/preview/<nonce>/master.m3u8).
const captionTrackProblems = (
  tracks: NonNullable<TableSnapshot['contentItems'][number]['captionTracks']>,
  manifest: string | undefined,
): string[] => {
  // The nonce the manifest lives under (as server-utils' manifestNonce).
  const nonce = manifest?.match(
    /\/(?:content-items\/[^/]+|preview)\/([^/]+)\/[^/]+$/,
  )?.[1];
  // The video's folder: everything before the version's nonce.
  const folder =
    manifest && nonce
      ? manifest.slice(0, manifest.length - `/${nonce}/master.m3u8`.length)
      : undefined;
  const problems: string[] = [];
  if (tracks.length > MAX_CAPTION_TRACKS) {
    problems.push(
      `${tracks.length} caption tracks, at most ${MAX_CAPTION_TRACKS}`,
    );
  }
  const languages = new Set<string>();
  for (const track of tracks) {
    if (languages.has(track.language)) {
      problems.push(`two caption tracks in ${track.language}`);
    }
    languages.add(track.language);
    if (track.nonce !== nonce) {
      problems.push(
        `track ${track.trackId} is for version ${track.nonce}, not the current ${nonce}`,
      );
    }
    if (
      !folder ||
      !track.key.startsWith(`${folder}/${track.nonce}/captions/`)
    ) {
      problems.push(
        `track ${track.trackId} key ${track.key} is outside the version's captions folder`,
      );
    }
  }
  const defaults = tracks.filter((track) => track.isDefault).length;
  if (defaults !== 1) {
    problems.push(`${defaults} default caption tracks, expected 1`);
  }
  return problems;
};

export const checkCaptionTracksValid = (
  snapshot: TableSnapshot,
): Violation[] => [
  ...snapshot.contentItems.flatMap((item) => {
    const tracks = item.captionTracks ?? [];
    if (tracks.length === 0) {
      return [];
    }
    const record = {
      courseId: item.courseId,
      contentItemId: item.contentItemId,
    };
    // The version students play: the ready video's own manifest, else the
    // previous one kept while a replacement transcodes (or after it failed),
    // whose tracks stay with it until the swap.
    const manifest = item.status === 'ready' ? item.s3Key : item.previousS3Key;
    return captionTrackProblems(tracks, manifest).map((message) =>
      violation('caption-tracks-valid', record, message),
    );
  }),
  ...snapshot.coursePreviews.flatMap((preview) => {
    const tracks = preview.captionTracks ?? [];
    const manifest =
      preview.status === 'ready' ? preview.s3Key : preview.previousS3Key;
    const problems =
      tracks.length === 0 ? [] : captionTrackProblems(tracks, manifest);
    // A coursePreview's captions are automatic only, so its captions being ready
    // means the pipeline wrote the played version's track (the transcribe
    // outcome writes the track and the status in one patch).
    const nonce = preview.s3Key?.split('/').at(-2);
    if (
      preview.status === 'ready' &&
      preview.captionsStatus === 'ready' &&
      !tracks.some((track) => track.nonce === nonce)
    ) {
      problems.push('a ready preview with ready captions has no track');
    }
    return problems.map((message) =>
      violation(
        'caption-tracks-valid',
        { courseId: preview.courseId },
        message,
      ),
    );
  }),
];

// 6 (files, #102). A file item has its file: the key, name, size and type,
// with the key in the version folder its submissionNonce names, which is what
// replacing or deleting it retires.
export const checkFileItemShape = (snapshot: TableSnapshot): Violation[] =>
  snapshot.contentItems
    .filter(({ type }) => type === 'file')
    .flatMap((item) => {
      const record = {
        courseId: item.courseId,
        contentItemId: item.contentItemId,
      };
      const missing = (
        [
          's3Key',
          'fileName',
          'fileSize',
          'mimeType',
          'submissionNonce',
        ] as const
      ).filter((attribute) => item[attribute] === undefined);
      if (missing.length > 0) {
        return [
          violation('file-item-shape', record, `missing ${missing.join(', ')}`),
        ];
      }
      return item.s3Key?.includes(
        `/content-items/${item.contentItemId}/${item.submissionNonce}/`,
      )
        ? []
        : [
            violation(
              'file-item-shape',
              record,
              `s3Key ${item.s3Key} isn't in the item's ${item.submissionNonce} folder`,
            ),
          ];
    });

// A course's preview video is well formed: it has a course, its duration is 1
// to 300 seconds, a ready one has a manifest under its own attempt's folder,
// failureReason is set only when failed (and then always), and a previous
// version is under the same course's preview folder.
export const checkCoursePreviewShape = (
  snapshot: TableSnapshot,
): Violation[] => {
  const courses = new Set(snapshot.courses.map(({ courseId }) => courseId));
  return snapshot.coursePreviews.flatMap((p) => {
    const folder = `courses/${p.courseId}/preview/`;
    const problems: string[] = [];
    if (!courses.has(p.courseId)) {
      problems.push('its course does not exist');
    }
    if (
      !Number.isFinite(p.durationSeconds) ||
      p.durationSeconds < 1 ||
      p.durationSeconds > PREVIEW_MAX_SECONDS
    ) {
      problems.push(
        `durationSeconds is ${p.durationSeconds}, not 1 to ${PREVIEW_MAX_SECONDS}`,
      );
    }
    if (!['processing', 'ready', 'failed'].includes(p.status)) {
      problems.push(`status ${p.status} is not allowed`);
    }
    if (
      p.status === 'ready' &&
      p.s3Key !== `${folder}${p.submissionNonce}/master.m3u8`
    ) {
      problems.push(
        `a ready preview's s3Key is ${p.s3Key ?? 'not set'}, not under its own ${folder}${p.submissionNonce}/ folder`,
      );
    }
    if (p.status === 'failed' && p.failureReason === undefined) {
      problems.push('a failed preview has no failureReason');
    }
    if (p.status !== 'failed' && p.failureReason !== undefined) {
      problems.push(`failureReason is set on a ${p.status} preview`);
    }
    if (p.previousS3Key !== undefined && !p.previousS3Key.startsWith(folder)) {
      problems.push(`previousS3Key ${p.previousS3Key} is outside ${folder}`);
    }
    return problems.map((problem) =>
      violation('course-preview-shape', { courseId: p.courseId }, problem),
    );
  });
};

export const MEDIA_CHECKS = [
  { name: 'video-transcode-state', check: checkVideoTranscodeState },
  { name: 'file-item-shape', check: checkFileItemShape },
  { name: 'caption-tracks-valid', check: checkCaptionTracksValid },
  { name: 'course-preview-shape', check: checkCoursePreviewShape },
] as const satisfies readonly Check[];
