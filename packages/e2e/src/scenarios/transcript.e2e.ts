/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { apiUser, createCaptionedVideoViaApi } from '../helpers/api.js';
import { webVttOf } from '../helpers/captions.js';
import { screenshot } from '../helpers/screenshots.js';
import {
  enrol,
  lessonVideo,
  openCourse,
  openTranscript,
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
