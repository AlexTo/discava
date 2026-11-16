/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { captionKey } from '@discava/common-server-utils/captions';
import {
  getS3Client,
  resolveLessonMediaBucketName,
} from '@discava/common-server-utils/lesson-media-bucket';
import { manifestNonce } from '@discava/common-server-utils/media-keys';
import {
  applyCaptionChange,
  createCoreTableService,
} from '@discava/core-table';

// The local stack, as `pnpm dev`'s APIs see it.
process.env.LOCAL_DEV = 'true';

export const CAPTION_CUE = 'Captions are shown as plain text.';

// Adds an uploaded caption track to a ready video of the course titled
// `courseTitle`, the way the instructor's upload will once it exists
// (Phase 6): the WebVTT file goes to S3Mock under the version's captions
// folder, and the item's tracks change through applyCaptionChange. Until
// then nothing in the product creates a track, so the scenario does it here.
export const seedCaptionTrack = async (
  courseTitle: string,
  videoTitle: string,
  language: { tag: string; label: string },
) => {
  const coreTable = await createCoreTableService();
  const { data: courses } = await coreTable.entities.course.scan
    .where((attr, op) => op.eq(attr.title, courseTitle))
    .go({ pages: 'all' });
  const [course] = courses;
  const { data: items } = await coreTable.entities.contentItem.query
    .primary({ courseId: course.courseId })
    .go({ pages: 'all' });
  const item = items.find((i) => i.title === videoTitle);
  if (!item?.s3Key) {
    throw new Error(`no ready video "${videoTitle}" in "${courseTitle}"`);
  }
  const nonce = manifestNonce(item.s3Key);
  if (!nonce) {
    throw new Error(`${item.s3Key} has no version folder`);
  }

  const trackId = randomUUID();
  const key = captionKey(item, nonce, trackId);
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: await resolveLessonMediaBucketName(),
      Key: key,
      ContentType: 'text/vtt',
      Body: `WEBVTT\n\n00:00.000 --> 00:03.000\n${CAPTION_CUE}\n`,
    }),
  );

  const { tracks } = applyCaptionChange(
    item.captionTracks,
    {
      type: 'add',
      nonce,
      track: {
        trackId,
        nonce,
        language: language.tag,
        label: language.label,
        source: 'uploaded',
        key,
      },
    },
    { currentNonce: nonce },
  );
  await coreTable.entities.contentItem
    .patch({
      courseId: item.courseId,
      moduleId: item.moduleId,
      lessonId: item.lessonId,
      contentItemId: item.contentItemId,
    })
    .set({ captionTracks: tracks, captionsStatus: 'ready' })
    .add({ captionTracksRev: 1 })
    .go();
};
