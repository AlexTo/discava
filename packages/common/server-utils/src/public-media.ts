/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The tag on a public media object nothing points at: an upload not yet
 * saved on its course, or an image since replaced or removed. The bucket's
 * lifecycle rule deletes objects carrying it after a day, so abandoned
 * uploads and retired images clean themselves up. Saving an image removes
 * the tag; replacing or removing it puts the tag back.
 */
export const UNATTACHED_TAG = { Key: 'lifecycle', Value: 'unattached' };

/** UNATTACHED_TAG as an x-amz-tagging header value, for a presigned PUT. */
export const UNATTACHED_TAGGING = `${UNATTACHED_TAG.Key}=${UNATTACHED_TAG.Value}`;

/**
 * Where a course's display image is stored. A new nonce per upload, so each
 * version has its own URL: CloudFront can cache it indefinitely, and a
 * replaced image is never served stale.
 */
export const courseImageKey = (courseId: string, nonce: string): string =>
  `courses/${courseId}/image/${nonce}.jpg`;

/** Whether `key` is one of `courseId`'s image keys, as courseImageKey makes. */
export const isCourseImageKey = (courseId: string, key: string): boolean =>
  new RegExp(`^courses/${courseId}/image/[0-9a-f-]{36}\\.jpg$`).test(key);
