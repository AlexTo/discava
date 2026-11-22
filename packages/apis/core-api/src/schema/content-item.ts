/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { ContentItemRefSchema } from './completion.js';

export const VideoUrlInputSchema = ContentItemRefSchema;

export type IVideoUrlInput = z.output<typeof VideoUrlInputSchema>;

// The video's HLS manifest. The signed cookies that let the player fetch it
// and its renditions and segments come back as Set-Cookie headers, never in
// the output, so they stay HttpOnly.
export const VideoUrlOutputSchema = z.object({
  url: z.string(),
  // Whether the player must send credentials for it: the signed CloudFront
  // cookies set alongside. Not in local dev, where S3Mock serves the video
  // unsigned and refuses credentialed cross-origin requests (#137).
  withCredentials: z.boolean(),
  // The played manifest's nonce, echoed back by saveVideoPosition so a save
  // for a version since replaced is ignored.
  versionId: z.string(),
  // The caller's saved position for this version, in seconds; 0 if none.
  resumeAt: z.number().int().min(0),
  // The played version's caption tracks, the default first. Never an S3 key,
  // the track's source beyond whether it was machine-translated, or the
  // caption status.
  captions: z.array(
    z.object({
      trackId: z.string(),
      // BCP 47 tag, e.g. en-US.
      language: z.string(),
      // Display label, e.g. English.
      label: z.string(),
      isDefault: z.boolean(),
      // True when the stored track's source is 'translated'.
      machineTranslated: z.boolean(),
      // Plain CloudFront URL under the version's folder, authorised by the
      // signed cookies set with this response (S3Mock's URL in local dev).
      url: z.string(),
    }),
  ),
  // How many questions the video has for this caller: 0 when it has none, and
  // 0 in a course that isn't published (an archived course is read-only).
  questionCount: z.number().int().min(0),
});

export type IVideoUrlOutput = z.output<typeof VideoUrlOutputSchema>;

export const PreviewVideoUrlInputSchema = z.object({ courseId: z.string() });

// As a lesson video's URL, without a saved position: a preview has none.
export const PreviewVideoUrlOutputSchema = VideoUrlOutputSchema.omit({
  resumeAt: true,
  questionCount: true,
});

export type IPreviewVideoUrlOutput = z.output<
  typeof PreviewVideoUrlOutputSchema
>;

// A day, as core-table's VIDEO_POSITION_MAX_SECONDS; not imported, so the
// schema (which the portals import for types) doesn't pull in the table.
const VIDEO_POSITION_MAX_SECONDS = 86_400;

export const SaveVideoPositionInputSchema = ContentItemRefSchema.extend({
  versionId: z.string(),
  positionSeconds: z.number().min(0).max(VIDEO_POSITION_MAX_SECONDS),
  durationSeconds: z.number().gt(0).max(VIDEO_POSITION_MAX_SECONDS),
});

export type ISaveVideoPositionInput = z.output<
  typeof SaveVideoPositionInputSchema
>;

// `saved` is false when ignored because the video's version changed.
// `positionSeconds` is what was stored (0 once the video is all but finished),
// so the player's cached `resumeAt` can follow it.
export const SaveVideoPositionOutputSchema = z.object({
  saved: z.boolean(),
  positionSeconds: z.number().int().min(0).optional(),
});

export type ISaveVideoPositionOutput = z.output<
  typeof SaveVideoPositionOutputSchema
>;

export const FileUrlInputSchema = ContentItemRefSchema;

export type IFileUrlInput = z.output<typeof FileUrlInputSchema>;

// A short-lived link to download a file item's file (#102).
export const FileUrlOutputSchema = z.object({
  url: z.string(),
});

export type IFileUrlOutput = z.output<typeof FileUrlOutputSchema>;
