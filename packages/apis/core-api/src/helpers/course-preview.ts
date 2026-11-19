/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { playableManifest } from './playback.js';

/**
 * The manifest a visitor plays as a course's preview: the course must be
 * published and the preview must have a playable version (its own once ready,
 * otherwise the previous one kept while a replacement processes). Undefined
 * when either fails. The one check behind both `course.previewVideoUrl` and
 * the `preview` in `course.publicView`, so they never disagree.
 */
export const playablePreviewManifest = (
  course: { status?: string } | null | undefined,
  preview:
    | { status?: string; s3Key?: string; previousS3Key?: string }
    | null
    | undefined,
): string | undefined =>
  course?.status === 'published' && preview
    ? playableManifest(preview)
    : undefined;
