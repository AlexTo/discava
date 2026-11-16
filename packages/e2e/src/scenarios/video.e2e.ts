/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { CAPTION_CUE, seedCaptionTrack } from '../helpers/captions.js';
import {
  addLesson,
  addModule,
  addVideoItem,
  createCourse,
  expectVideoPreviewToPlay,
  publishCourse,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import {
  enrol,
  expectCourseCompleted,
  lessonItem,
  lessonVideo,
  markItemDone,
  openCourse,
  startFirstLesson,
} from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';
import { expectToPlay, THREE_SECOND_VIDEO } from '../helpers/video.js';

// A lesson video from upload to playback: the upload goes to S3Mock, the event
// runner transcodes it to HLS with ffmpeg (standing in for MediaConvert, #137)
// and marks it ready, and both portals play it through their APIs' signed
// URLs.
test('an instructor uploads a video, and a student watches it', async ({
  browser,
}) => {
  const course = uniqueName('E2E video course');
  const instructor = await browser.newPage();
  const student = await browser.newPage();

  await test.step('the instructor uploads a video and previews it', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Ivy', ['instructor']));
    await createCourse(instructor, {
      title: course,
      summary: 'A video course made by the end-to-end tests.',
    });
    await addModule(instructor, 'Module one');
    await addLesson(instructor, 'Lesson one');
    await addVideoItem(instructor, {
      title: 'Video one',
      file: THREE_SECOND_VIDEO,
    });
    await expectVideoPreviewToPlay(instructor, 'Video one');
    // A second video, for checking that the viewer's preferences carry over.
    await addVideoItem(instructor, {
      title: 'Video two',
      file: THREE_SECOND_VIDEO,
    });
    await expectVideoPreviewToPlay(instructor, 'Video two');
    await expect(
      instructor.getByRole('button', { name: 'Playback speed' }),
    ).toBeVisible();
    await screenshot(instructor, 'instructor video preview with controls');
    await publishCourse(instructor);
  });

  await test.step('a new student enrols and watches it', async () => {
    await openCourse(student, course);
    await enrol(student, newUser('Sam', ['student']));
    await startFirstLesson(student);

    const video = lessonVideo(student, 'Video one');
    const player = (title: string) =>
      lessonItem(student, title).getByRole('group', { name: 'Video player' });
    const bar = (title: string) =>
      lessonItem(student, title).getByRole('group', {
        name: 'Video controls',
      });
    const state = (title: string) =>
      lessonVideo(student, title).evaluate((v: HTMLVideoElement) => ({
        paused: v.paused,
        muted: v.muted,
        volume: v.volume,
        speed: v.playbackRate,
        time: v.currentTime,
      }));

    // The bar is on show while the video is paused.
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.duration || 0), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    await expect(bar('Video one')).toHaveAttribute('data-visible', 'true');
    // The bar is at the bottom of the player: bring it into the picture.
    await player('Video one').scrollIntoViewIfNeeded();
    await screenshot(student, 'control bar on a paused video');

    await expectToPlay(video);

    const speed = lessonItem(student, 'Video one').getByRole('button', {
      name: 'Playback speed',
    });
    await speed.click();
    await expect(
      student.getByRole('menuitemradio', { name: '1.5x' }),
    ).toBeVisible();
    await screenshot(student, 'speed menu');
    await student.getByRole('menuitemradio', { name: '1.5x' }).click();
    await expect(speed).toHaveText('1.5x');
    expect((await state('Video one')).speed).toBe(1.5);
    await screenshot(student, 'control bar at 1.5x');

    // Mute and volume. The player is muted by `expectToPlay`, so the first M
    // unmutes. The Mute button keeps its name and shows its state as pressed.
    const mute = lessonItem(student, 'Video one').getByRole('button', {
      name: 'Mute',
    });
    await player('Video one').press('m');
    await expect(mute).toHaveAttribute('aria-pressed', 'false');
    expect((await state('Video one')).muted).toBe(false);
    await player('Video one').press('m');
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
    expect((await state('Video one')).muted).toBe(true);
    await screenshot(student, 'muted');
    // Lowering the volume unmutes, as in other players.
    for (let i = 0; i < 3; i++) {
      await player('Video one').press('ArrowDown');
    }
    await expect(mute).toHaveAttribute('aria-pressed', 'false');
    const lowered = await state('Video one');
    expect(lowered.muted).toBe(false);
    expect(lowered.volume).toBeCloseTo(0.85, 2);
    await expect(
      lessonItem(student, 'Video one').getByRole('slider', { name: 'Volume' }),
    ).toHaveAttribute('aria-valuetext', '85%');
    await screenshot(student, 'volume lowered to 85 percent');

    // Shortcuts: K plays and pauses, 5 jumps to half way, the right arrow
    // seeks on, and < and > step the speed (1.5x to 1.25x, then up to 1.75x).
    // The video has ended by now (a K on an ended video plays it again), so
    // go back to the start and check K starts it and then stops it.
    await player('Video one').press('0');
    await expect.poll(async () => (await state('Video one')).time).toBe(0);
    await player('Video one').press('k');
    await expect
      .poll(async () => (await state('Video one')).paused)
      .toBe(false);
    await player('Video one').press('k');
    await expect.poll(async () => (await state('Video one')).paused).toBe(true);
    await expect(bar('Video one')).toHaveAttribute('data-visible', 'true');
    await screenshot(student, 'paused with the K shortcut');
    await player('Video one').press('5');
    await expect
      .poll(async () => (await state('Video one')).time)
      .toBeGreaterThan(1);
    expect((await state('Video one')).time).toBeLessThan(2);
    const half = (await state('Video one')).time;
    await player('Video one').press('ArrowRight');
    await expect
      .poll(async () => (await state('Video one')).time)
      .toBeGreaterThan(half + 0.5);
    await player('Video one').press('<');
    await expect.poll(async () => (await state('Video one')).speed).toBe(1.25);
    await player('Video one').press('>');
    await player('Video one').press('>');
    await expect.poll(async () => (await state('Video one')).speed).toBe(1.75);
    await expect(speed).toHaveText('1.75x');
    await screenshot(student, 'speed stepped to 1.75x with the shortcuts');

    // Fullscreen, where headless Chromium allows it.
    await player('Video one').press('f');
    const fullscreen = await expect
      .poll(() => student.evaluate(() => document.fullscreenElement !== null), {
        timeout: 3_000,
      })
      .toBe(true)
      .then(
        () => true,
        () => false,
      );
    if (fullscreen) {
      await screenshot(student, 'fullscreen');
      await player('Video one').press('f');
      await expect
        .poll(() => student.evaluate(() => document.fullscreenElement))
        .toBeNull();
    }

    // The preferences outlive the page and apply to another video.
    await student.reload();
    const second = lessonVideo(student, 'Video two');
    await expect
      .poll(() => second.evaluate((v: HTMLVideoElement) => v.duration || 0), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    await expect.poll(async () => (await state('Video two')).speed).toBe(1.75);
    const restored = await state('Video two');
    expect(restored.volume).toBeCloseTo(0.85, 2);
    expect(restored.muted).toBe(false);
    await expect(
      lessonItem(student, 'Video two').getByRole('button', {
        name: 'Playback speed',
      }),
    ).toHaveText('1.75x');
    await player('Video two').scrollIntoViewIfNeeded();
    await screenshot(student, 'second video with the saved speed and volume');

    // Reduced motion: the bar shows while paused, hides once activity stops
    // while playing, and never fades.
    const transition = () =>
      bar('Video two').evaluate(
        (el) => getComputedStyle(el).transitionProperty,
      );
    expect(await transition()).toBe('opacity');
    await student.emulateMedia({ reducedMotion: 'reduce' });
    expect(await transition()).toBe('none');
    await expect(bar('Video two')).toHaveAttribute('data-visible', 'true');
    await player('Video two').scrollIntoViewIfNeeded();
    await screenshot(student, 'reduced motion, bar on a paused video');
    // Slow enough to outlast the 3 seconds before the bar hides, and with
    // focus out of the player, which keeps the bar on.
    await second.evaluate(async (v: HTMLVideoElement) => {
      v.playbackRate = 0.5;
      (document.activeElement as HTMLElement | null)?.blur();
      await v.play();
    });
    await expect(bar('Video two')).toHaveAttribute('data-visible', 'false', {
      timeout: 8_000,
    });
    expect((await state('Video two')).paused).toBe(false);
    await screenshot(student, 'reduced motion, bar hidden while playing');

    // Resuming. The test video is 3 seconds long, so "about where it
    // stopped" is a seek to half way, and the whole video counts as watched
    // only at its very end. Saves go out on a seek, a pause and every 10 seconds of playing.
    await student.emulateMedia({ reducedMotion: 'no-preference' });
    const saved = () =>
      student.waitForResponse(
        (response) =>
          response.url().includes('contentItem.saveVideoPosition') &&
          response.ok(),
      );
    await second.evaluate((v: HTMLVideoElement) => v.pause());
    const halfSaved = saved();
    await player('Video two').press('5');
    await halfSaved;

    await student.reload();
    await expect
      .poll(() => second.evaluate((v: HTMLVideoElement) => v.duration || 0), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    // Within 10 seconds before where it stopped, and not playing.
    await expect
      .poll(async () => (await state('Video two')).time)
      .toBeGreaterThan(0.5);
    expect((await state('Video two')).paused).toBe(true);
    await expect(lessonItem(student, 'Video two')).toContainText('Resumed at');
    await player('Video two').scrollIntoViewIfNeeded();
    await screenshot(student, 'resumed where the video stopped');

    // Watching to the end clears the position: the next visit starts over.
    const nearEndSaved = saved();
    await second.evaluate((v: HTMLVideoElement) => {
      v.playbackRate = 2;
      v.currentTime = Math.max(0, v.duration - 1);
    });
    await nearEndSaved;
    const endSaved = saved();
    await second.evaluate((v: HTMLVideoElement) => v.play());
    await endSaved;
    await expect
      .poll(() => second.evaluate((v: HTMLVideoElement) => v.ended))
      .toBe(true);
    await student.reload();
    await expect
      .poll(() => second.evaluate((v: HTMLVideoElement) => v.duration || 0), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    expect((await state('Video two')).time).toBe(0);
    await expect(lessonItem(student, 'Video two')).not.toContainText(
      'Resumed at',
    );
    await screenshot(student, 'a finished video starts at the beginning');

    await markItemDone(student, 'Video one');
    await markItemDone(student, 'Video two');
  });

  await test.step('a student reads along with captions', async () => {
    // Nothing creates a track yet (the instructor's upload is Phase 6), so
    // the scenario adds one the way that upload will.
    await seedCaptionTrack(course, 'Video one', {
      tag: 'en-US',
      label: 'English',
    });
    await student.reload();
    const video = lessonVideo(student, 'Video one');
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.duration || 0), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    const videoTwo = lessonItem(student, 'Video two');
    // A video with no tracks has no captions control.
    await expect(
      videoTwo.getByRole('button', { name: /^Captions/ }),
    ).toHaveCount(0);

    const item = lessonItem(student, 'Video one');
    const captions = item.getByRole('button', { name: /^Captions/ });
    await expect(captions).toBeVisible();
    await expect(captions).toHaveAccessibleName('Captions: off');
    await item
      .getByRole('group', { name: 'Video player' })
      .scrollIntoViewIfNeeded();
    await captions.click();
    await expect(
      student.getByRole('menuitemradio', { name: 'English (default)' }),
    ).toBeVisible();
    await screenshot(student, 'captions menu with the default track');

    await student
      .getByRole('menuitemradio', { name: 'English (default)' })
      .click();
    await expect(captions).toHaveAccessibleName('Captions: English');
    await expect
      .poll(() =>
        video.evaluate((v: HTMLVideoElement) => {
          v.currentTime = 1;
          const cues = v.textTracks[0]?.activeCues;
          return cues && cues.length > 0 ? (cues[0] as VTTCue).text : '';
        }),
      )
      .toBe(CAPTION_CUE);
    await screenshot(student, 'a caption shown over the video');

    // The choice survives a reload, and the C shortcut turns it off and on.
    await student.reload();
    await expect(captions).toHaveAccessibleName('Captions: English');
    await item.getByRole('group', { name: 'Video player' }).focus();
    await student.keyboard.press('c');
    await expect(captions).toHaveAccessibleName('Captions: off');
    await student.keyboard.press('c');
    await expect(captions).toHaveAccessibleName('Captions: English');
  });

  await test.step('the course shows as completed', async () => {
    await student.getByRole('link', { name: course }).click();
    await expectCourseCompleted(student);
  });
});
