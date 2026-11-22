/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type ApiUser,
  addCourseInstructor,
  apiUser,
  createCaptionedVideoViaApi,
} from '../helpers/api.js';
import { LESSON_MEDIA_BUCKET } from '../helpers/assignment.js';
import { webVtt } from '../helpers/captions.js';
import { SERVICES } from '../helpers/portals.js';
import { waitForQueuesToDrain } from '../helpers/router.js';
import { expect, test } from '../helpers/table-invariants.js';
import { uniqueName } from '../helpers/users.js';

// Two instructors of one course attach a caption track for the same language
// at the same moment (research R-8). Writes to a video's track list are
// conditional on its revision, so one of them loses with CONFLICT, or reads
// the other's result and replaces it; either way one track is left for the
// language, and the file of any track that did not win is gone.

type Video = Awaited<ReturnType<typeof createCaptionedVideoViaApi>>;

let first: ApiUser;
let second: ApiUser;
let video: Video;

test.beforeEach(async () => {
  first = await apiUser('Ines', ['instructor']);
  second = await apiUser('Ida', ['instructor']);
  video = await createCaptionedVideoViaApi(first, uniqueName('Caption race'));
  await addCourseInstructor(video.courseId, second);
});

// The track files in the video version's captions folder (S3Mock lists
// anonymously over plain HTTP).
const captionFiles = async () => {
  const prefix = `courses/${video.courseId}/modules/${video.moduleId}/lessons/${video.lessonId}/content-items/${video.contentItemId}/${video.versionId}/captions/`;
  const response = await fetch(
    `${SERVICES.s3Mock}${LESSON_MEDIA_BUCKET}?list-type=2&prefix=${encodeURIComponent(prefix)}`,
  );
  const xml = await response.text();
  return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) =>
    m[1]!.slice(prefix.length).replace(/\.vtt$/, ''),
  );
};

// Uploads a caption file as the instructor would, ready to attach.
const upload = async (instructor: ApiUser, cue: string) => {
  const target =
    await instructor.instructor.contentItem.captionUploadUrl.mutate(video);
  const response = await fetch(target.url, {
    method: 'PUT',
    headers: target.headers,
    body: webVtt(cue),
  });
  expect(response.ok).toBe(true);
  return target.uploadId;
};

test('two instructors attaching the same language at once leave one track and no orphan file', async () => {
  const [uploadA, uploadB] = await Promise.all([
    upload(first, 'From the first instructor'),
    upload(second, 'From the second instructor'),
  ]);

  const results = await Promise.allSettled([
    first.instructor.contentItem.attachCaption.mutate({
      ...video,
      uploadId: uploadA,
      language: 'es-ES',
    }),
    second.instructor.contentItem.attachCaption.mutate({
      ...video,
      uploadId: uploadB,
      language: 'es-ES',
    }),
  ]);

  const rejected = results.flatMap((result) =>
    result.status === 'rejected'
      ? [(result.reason as { data?: { code?: string } }).data?.code]
      : [],
  );
  expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
  // A loser is told to try again; nothing else goes wrong.
  expect(rejected.every((code) => code === 'CONFLICT')).toBe(true);

  const { captions } =
    await first.instructor.contentItem.createVideoUrl.query(video);
  const spanish = captions.filter((track) => track.language === 'es-ES');
  expect(spanish).toHaveLength(1);
  expect(spanish[0]?.source).toBe('uploaded');
  // The automatic English track is untouched and still the default.
  expect(captions.map((track) => track.language).sort()).toEqual([
    'en-US',
    'es-ES',
  ]);
  expect(captions.find((track) => track.isDefault)?.language).toBe('en-US');

  // No orphan: the folder holds exactly the files of the tracks left (the
  // replaced one's is deleted just after the write).
  await expect
    .poll(async () => (await captionFiles()).sort(), { timeout: 15_000 })
    .toEqual(captions.map((track) => track.trackId).sort());
});

test('an upload and a caption language change adding the same language at once leave the upload', async () => {
  const uploadId = await upload(first, 'An uploaded Spanish cue');

  const results = await Promise.allSettled([
    first.instructor.contentItem.attachCaption.mutate({
      ...video,
      uploadId,
      language: 'es-ES',
    }),
    first.instructor.course.updateCaptionLanguages.mutate({
      courseId: video.courseId,
      languages: ['es-ES'],
    }),
  ]);

  // The upload may lose its conditional write to the translation, and is
  // then told to try again; the language change always succeeds.
  expect(results[1].status).toBe('fulfilled');
  if (results[0].status === 'rejected') {
    expect((results[0].reason as { data?: { code?: string } }).data?.code).toBe(
      'CONFLICT',
    );
    const retry = await upload(first, 'An uploaded Spanish cue');
    await first.instructor.contentItem.attachCaption.mutate({
      ...video,
      uploadId: retry,
      language: 'es-ES',
    });
  }

  // The translation queue handles the language change, then the upload's own.
  await waitForQueuesToDrain();

  const { captions } =
    await first.instructor.contentItem.createVideoUrl.query(video);
  const spanish = captions.filter((track) => track.language === 'es-ES');
  expect(spanish).toHaveLength(1);
  expect(spanish[0]?.source).toBe('uploaded');
});
