/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// Caption files (WebVTT) for lesson videos: where they live and what an
// uploaded one must look like.

/** The largest caption file accepted: 1 MB. */
export const CAPTION_MAX_BYTES = 1_048_576;

interface ItemRef {
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
}

const itemFolder = (ref: ItemRef) =>
  `courses/${ref.courseId}/modules/${ref.moduleId}/lessons/${ref.lessonId}/content-items/${ref.contentItemId}`;

/**
 * A track's key in the lesson media bucket, inside its version's folder, so
 * the signed cookies that authorise the version cover it and retiring the
 * version deletes it.
 */
export const captionKey = (ref: ItemRef, nonce: string, trackId: string) =>
  `${itemFolder(ref)}/${nonce}/captions/${trackId}.vtt`;

/** Where an instructor's caption upload lands, in the upload bucket. */
export const captionUploadKey = (ref: ItemRef, uploadId: string) =>
  `${itemFolder(ref)}/captions/${uploadId}.vtt`;

/**
 * The Transcribe job for a video version's automatic captions. Unique per
 * version, so a replacement never collides with the old version's job.
 */
export const transcribeJobName = (contentItemId: string, nonce: string) =>
  `captions-${contentItemId}-${nonce}`;

/**
 * The audio-only file the transcode writes for Transcribe, in the upload
 * bucket (private, expiring), where Transcribe reads it.
 */
export const transcribeInputKey = (nonce: string) =>
  `transcribe-input/${nonce}.mp4`;

/**
 * Where Transcribe writes its outputs for a version, in the lesson media
 * bucket, ending in `/`. Outside `<nonce>/*` on purpose: the signed cookies
 * authorise that folder, and students must not be able to fetch the JSON
 * transcript. transcribe-complete copies the WebVTT into the version's
 * captions folder and deletes what is left here.
 */
export const transcribeOutputPrefix = (ref: ItemRef, nonce: string) =>
  `${itemFolder(ref)}/transcribe-output/${nonce}/`;

/**
 * Whether bytes are a WebVTT file we accept: an optional UTF-8 byte order
 * mark, then `WEBVTT` followed by a space, tab or newline; valid UTF-8 with no
 * NUL bytes; at least one cue timing line (`-->`).
 */
export const isWebVtt = (bytes: Uint8Array): boolean => {
  if (bytes.includes(0)) {
    return false;
  }
  let text: string;
  try {
    // ignoreBOM keeps a leading BOM in the text so it can be skipped below.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    return false;
  }
  const body = text.startsWith('﻿') ? text.slice(1) : text;
  return /^WEBVTT[ \t\r\n]|^WEBVTT$/.test(body) && /^.*-->.*$/m.test(body);
};
