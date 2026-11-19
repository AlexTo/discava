/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/** The manifest an instructor can play: its own once ready, else the previous version. */
export const previewPlayableManifest = (preview: {
  status: string;
  s3Key?: string;
  previousS3Key?: string;
}): string | undefined =>
  preview.status === 'ready' ? preview.s3Key : preview.previousS3Key;

/** A preview as the editor sees it (and course.view returns it). */
export const asPreviewSummary = (preview: {
  status: 'processing' | 'ready' | 'failed';
  failureReason?: 'too-long' | 'transcode-error';
  durationSeconds: number;
  submissionNonce: string;
  s3Key?: string;
  previousS3Key?: string;
}) => ({
  status: preview.status,
  ...(preview.failureReason && { failureReason: preview.failureReason }),
  durationSeconds: preview.durationSeconds,
  hasPlayableVersion: previewPlayableManifest(preview) !== undefined,
  submissionNonce: preview.submissionNonce,
});
