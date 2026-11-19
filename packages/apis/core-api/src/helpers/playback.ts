/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The manifest a student plays for a video item: its own once transcoded,
 * otherwise the previous version kept while a replacement transcodes or
 * after the replacement failed (#209). Undefined when there's nothing to
 * play yet: a first upload still transcoding, or one that failed.
 */
export const playableManifest = (item: {
  status?: string;
  s3Key?: string;
  previousS3Key?: string;
}): string | undefined =>
  item.status === 'ready' ? item.s3Key : item.previousS3Key;

// Caption attributes of a video record: S3 keys, the writers' revision and the
// captioning status. Students get a video's tracks only from videoUrl, as
// URLs, so none of these goes out with the course.
const CAPTION_ATTRIBUTES = [
  'captionTracks',
  'captionTracksRev',
  'captionsStatus',
  'captionsPendingSince',
] as const;

const withoutCaptionAttributes = <T extends object>(item: T): T => {
  if (!CAPTION_ATTRIBUTES.some((name) => name in item)) {
    return item;
  }
  const copy = { ...item } as Record<string, unknown>;
  for (const name of CAPTION_ATTRIBUTES) {
    delete copy[name];
  }
  return copy as T;
};

/**
 * A content item as students see it. A video being replaced shows as ready,
 * with the version they can play, so the replacement isn't visible to them
 * until it is ready. No caption attributes are exposed.
 */
export const asStudentContentItem = <
  T extends {
    type?: string;
    status?: string;
    s3Key?: string;
    previousS3Key?: string;
  },
>(
  record: T,
): T => {
  const item = withoutCaptionAttributes(record);
  if (item.type !== 'video' || item.status === 'ready') {
    return item;
  }
  const manifest = playableManifest(item);
  return manifest ? { ...item, status: 'ready', s3Key: manifest } : item;
};
