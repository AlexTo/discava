/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type ApiUser,
  apiUser,
  createCaptionedVideoViaApi,
} from '../helpers/api.js';
import { webVttOf } from '../helpers/captions.js';
import { screenshot } from '../helpers/screenshots.js';
import {
  enrol,
  expectAfterReloads,
  lessonVideo,
  openCourse,
  openTranscript,
  searchTranscripts,
  startFirstLesson,
  transcriptLines,
} from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, uniqueName } from '../helpers/users.js';

// The transcript panel beside a lesson video: every line of the caption
// track, and a chosen line seeks the video there.
test('a learner reads a video’s transcript and jumps to a line', async ({
  page,
}) => {
  const phrase = uniqueName('quasar');
  const title = uniqueName('E2E transcript course');
  const instructor = await apiUser('Ivy', ['instructor']);
  const video = await createCaptionedVideoViaApi(instructor, title);

  await test.step('the instructor attaches an English track and publishes', async () => {
    const target =
      await instructor.instructor.contentItem.captionUploadUrl.mutate(video);
    const response = await fetch(target.url, {
      method: 'PUT',
      headers: target.headers,
      body: webVttOf([
        { start: 0, end: 1, text: `Welcome to the ${phrase} lesson` },
        { start: 1, end: 2, text: 'Here is the second line' },
        { start: 2, end: 3, text: 'And this is the third line' },
      ]),
    });
    expect(response.ok).toBe(true);
    await instructor.instructor.contentItem.attachCaption.mutate({
      ...video,
      uploadId: target.uploadId,
      language: 'en-US',
    });
    await instructor.instructor.course.publish.mutate({
      courseId: video.courseId,
    });
  });

  await openCourse(page, title);
  await enrol(page, newUser('Sam', ['student']));
  await startFirstLesson(page);

  const panel = await openTranscript(page, 'Video');
  const lines = transcriptLines(panel);
  await expect(lines).toHaveCount(3);
  await expect(lines.nth(0)).toContainText(phrase);
  await screenshot(page, 'transcript-panel-open');

  // The test video is three seconds long, so the third line starts at 2 s.
  // Nothing was playing, so reaching it means the click seeked.
  await lines.nth(2).click();
  await expect
    .poll(() =>
      lessonVideo(page, 'Video').evaluate(
        (v: HTMLVideoElement) => v.currentTime,
      ),
    )
    .toBeGreaterThanOrEqual(2);

  await test.step('the transcript works by keyboard alone', async () => {
    // Back to the start with the panel closed, so the list opens on line one.
    const toggle = page.getByRole('button', { name: 'Transcript' });
    await toggle.click();
    await expect(
      page.getByRole('region', { name: /^Transcript/ }),
    ).toBeHidden();
    await lessonVideo(page, 'Video').evaluate((v: HTMLVideoElement) => {
      v.pause();
      v.currentTime = 0;
    });
    await toggle.focus();
    await page.keyboard.press('Enter');
    const keyboardPanel = page.getByRole('region', { name: /^Transcript/ });
    await expect(keyboardPanel).toBeVisible();
    // The control bar has more buttons after "Transcript": Tab on to the list.
    const inList = () =>
      page.evaluate(
        () =>
          !!document.activeElement?.closest(
            '[data-slot="transcript-panel"] ol',
          ),
      );
    for (let tabs = 0; tabs < 10 && !(await inList()); tabs++) {
      await page.keyboard.press('Tab');
    }
    expect(await inList()).toBe(true);
    const keyboardLines = transcriptLines(keyboardPanel);
    await expect(keyboardLines.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(keyboardLines.nth(2)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect
      .poll(() =>
        lessonVideo(page, 'Video').evaluate(
          (v: HTMLVideoElement) => v.currentTime,
        ),
      )
      .toBeGreaterThanOrEqual(2);
    await expect(keyboardLines.nth(2)).toBeFocused();
    await screenshot(page, 'transcript-panel-keyboard');
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(
        () =>
          !document.activeElement?.closest('[data-slot="transcript-panel"]'),
      ),
    ).toBe(true);
  });

  await page.setViewportSize({ width: 375, height: 800 });
  const player = page.getByRole('group', { name: 'Video player' });
  await expect(panel).toBeVisible();
  const [playerBox, panelBox] = await Promise.all([
    player.boundingBox(),
    panel.boundingBox(),
  ]);
  expect(panelBox!.y).toBeGreaterThanOrEqual(
    playerBox!.y + playerBox!.height - 1,
  );
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await panel.scrollIntoViewIfNeeded();
  await screenshot(page, 'transcript-panel-phone');
});

// A course with one captioned video, published. The two words of `phrase`
// are said in two neighbouring caption lines, the first starting at 2 s: the
// test video is 3 s long and a player never opens on its last second.
const publishCourseWithPhrase = async (
  instructor: ApiUser,
  title: string,
  phrase: string,
) => {
  const video = await createCaptionedVideoViaApi(instructor, title);
  const [first, second] = phrase.split(' ');
  const target =
    await instructor.instructor.contentItem.captionUploadUrl.mutate(video);
  const response = await fetch(target.url, {
    method: 'PUT',
    headers: target.headers,
    body: webVttOf([
      { start: 0, end: 2, text: 'Welcome to this lesson' },
      { start: 2, end: 2.5, text: `and now ${first}` },
      { start: 2.5, end: 3, text: `${second} appears` },
    ]),
  });
  expect(response.ok).toBe(true);
  await instructor.instructor.contentItem.attachCaption.mutate({
    ...video,
    uploadId: target.uploadId,
    language: 'en-US',
  });
  await instructor.instructor.course.publish.mutate({
    courseId: video.courseId,
  });
  return video;
};

// Search over what was said in a course: a moment is found, and choosing it
// opens the lesson's video at that second.
test('a learner searches a course’s transcripts and opens the moment', async ({
  page,
}) => {
  const phrase = `${uniqueName('nebula')} ${uniqueName('pulsar')}`;
  const title = uniqueName('E2E transcript search course');
  const instructor = await apiUser('Ivy', ['instructor']);
  await publishCourseWithPhrase(instructor, title, phrase);

  await openCourse(page, title);
  await enrol(page, newUser('Sam', ['student']));

  // Indexing lags the upload by a few seconds.
  await searchTranscripts(page, phrase);
  const result = page.getByRole('link', { name: /Lesson 1/ });
  await expectAfterReloads(page, async () => {
    await expect(result).toHaveCount(1, { timeout: 5_000 });
  });
  await expect(result).toContainText('Video');
  await expect(result).toContainText('0:02');
  await screenshot(page, 'transcript-search-results');

  await result.click();
  await page.waitForURL(/\/lesson\/[0-9a-f-]+\?.*item=.*t=2/);
  await expect(page.getByText('Starting at 0:02')).toBeVisible();
  await expect
    .poll(() =>
      lessonVideo(page, 'Video').evaluate(
        (v: HTMLVideoElement) => v.currentTime,
      ),
    )
    .toBe(2);
  await screenshot(page, 'transcript-search-opened');

  await searchTranscripts(page, uniqueName('nonsense'));
  await expect(page.getByText(/No moments match/).first()).toBeVisible();
  await screenshot(page, 'transcript-search-empty');
});

test('transcript search is refused to someone not enrolled, and hides a hidden lesson at once', async () => {
  const phrase = `${uniqueName('nebula')} ${uniqueName('pulsar')}`;
  const instructor = await apiUser('Ivy', ['instructor']);
  const video = await publishCourseWithPhrase(
    instructor,
    uniqueName('E2E transcript access course'),
    phrase,
  );
  const enrolled = await apiUser('Sam', ['student']);
  const outsider = await apiUser('Olly', ['student']);
  await enrolled.core.course.enrol.mutate({ courseId: video.courseId });
  const search = (user: ApiUser) =>
    user.core.transcript.search.query({ courseId: video.courseId, q: phrase });

  await expect(search(outsider)).rejects.toMatchObject({
    data: { code: 'FORBIDDEN' },
  });

  // Indexing lags the upload by a few seconds.
  await expect
    .poll(async () => (await search(enrolled)).items.length, {
      timeout: 60_000,
    })
    .toBe(1);

  await instructor.instructor.lesson.hide.mutate({
    courseId: video.courseId,
    moduleId: video.moduleId,
    lessonId: video.lessonId,
  });
  // No waiting: the index still holds it, the access rule doesn't.
  expect((await search(enrolled)).items).toEqual([]);
});
