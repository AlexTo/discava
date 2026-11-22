/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AUTO_CAPTION_CUE,
  chooseCaptionLanguages,
  closeDialog,
  expectCaptionTrackListed,
  LOCAL_TRANSLATION,
  shownCue,
} from '../helpers/captions.js';
import {
  addLesson,
  addModule,
  addVideoItem,
  createCourse,
  publishCourse,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { coursePageUrl } from '../helpers/public-pages.js';
import { screenshot } from '../helpers/screenshots.js';
import {
  enrol,
  lessonItem,
  lessonVideo,
  openCourse,
  startFirstLesson,
} from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';
import { expectToPlay, THREE_SECOND_VIDEO } from '../helpers/video.js';

test('an instructor chooses caption languages and every video gets them', async ({
  browser,
}) => {
  const course = uniqueName('E2E caption languages course');
  const instructor = await browser.newPage();
  const student = await browser.newPage();
  const visitor = await browser.newPage();
  let courseId = '';

  await test.step('the instructor chooses Spanish and French', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Tess', ['instructor']));
    await createCourse(instructor, {
      title: course,
      summary: 'A course translated by the end-to-end tests.',
    });
    courseId = instructor.url().split('/').pop() as string;
    await addModule(instructor, 'Module one');
    await addLesson(instructor, 'Lesson one');
    await addVideoItem(instructor, {
      title: 'Video one',
      file: THREE_SECOND_VIDEO,
    });
    // The automatic captions are the source of the translations.
    const automatic = await expectCaptionTrackListed(
      instructor,
      'Video one',
      'English',
    );
    await expect(
      automatic.getByRole('listitem', { name: 'English' }),
    ).toBeVisible();
    await closeDialog(instructor);

    await chooseCaptionLanguages(instructor, course, ['Spanish', 'French']);
    await screenshot(instructor, 'caption-languages-chosen');

    const dialog = await expectCaptionTrackListed(
      instructor,
      'Video one',
      'Español',
    );
    await expect(
      dialog.getByRole('listitem', { name: 'Français' }),
    ).toBeVisible();
    await screenshot(instructor, 'captions-dialog-translated-tracks');
    await closeDialog(instructor);
  });

  await test.step('a video added later gets both without touching the languages', async () => {
    await addVideoItem(instructor, {
      title: 'Video two',
      file: THREE_SECOND_VIDEO,
    });
    const dialog = await expectCaptionTrackListed(
      instructor,
      'Video two',
      'Español',
    );
    await expect(
      dialog.getByRole('listitem', { name: 'Français' }),
    ).toBeVisible();
    await closeDialog(instructor);
    await publishCourse(instructor);
  });

  await test.step('a student sees the translated captions marked and picks Spanish', async () => {
    await openCourse(student, course);
    await enrol(student, newUser('Sol', ['student']));
    await startFirstLesson(student);

    const item = lessonItem(student, 'Video one');
    const video = lessonVideo(student, 'Video one');
    const captions = item.getByRole('button', { name: /^Captions/ });
    await expect(captions).toBeVisible({ timeout: 30_000 });
    await item
      .getByRole('group', { name: 'Video player' })
      .scrollIntoViewIfNeeded();
    await captions.click();
    const tracks = student.getByRole('menuitemradio');
    await expect(tracks).toHaveText([
      'Off',
      'English (default)',
      'Español (auto-translated)',
      'Français (auto-translated)',
    ]);
    await screenshot(student, 'captions-menu-auto-translated');
    await student
      .getByRole('menuitemradio', { name: 'Español (auto-translated)' })
      .click();
    await expect(captions).toHaveAccessibleName(
      'Captions: Español (auto-translated)',
    );
    await expect
      .poll(() => shownCue(video))
      .toBe(LOCAL_TRANSLATION('es-ES', AUTO_CAPTION_CUE));
  });

  await test.step('the remembered language shows on the next video', async () => {
    await student.reload();
    const item = lessonItem(student, 'Video two');
    const captions = item.getByRole('button', { name: /^Captions/ });
    await expect(captions).toBeVisible({ timeout: 30_000 });
    await expect(captions).toHaveAccessibleName(
      'Captions: Español (auto-translated)',
    );
    await expect
      .poll(() => shownCue(lessonVideo(student, 'Video two')))
      .toBe(LOCAL_TRANSLATION('es-ES', AUTO_CAPTION_CUE));
  });

  await test.step('a signed-out visitor sees the preview video’s translated languages', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses/${courseId}`);
    const previewArea = instructor.locator(
      'section[aria-labelledby="preview-video-heading"]',
    );
    await previewArea
      .getByLabel('Preview video file')
      .setInputFiles(THREE_SECOND_VIDEO);
    await expect(previewArea.locator('video')).toBeAttached({
      timeout: 90_000,
    });

    await visitor.goto(coursePageUrl(courseId));
    await visitor.getByRole('button', { name: 'Play preview' }).click();
    await expectToPlay(visitor.locator('video[data-slot="hls-video"]'));
    const captions = visitor.getByRole('button', { name: /^Captions/ });
    // The translations arrive after the automatic captions do.
    await expect(async () => {
      await captions.click();
      await expect(
        visitor.getByRole('menuitemradio', {
          name: 'Español (auto-translated)',
        }),
      ).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 90_000 });
    await expect(
      visitor.getByRole('menuitemradio', {
        name: 'Français (auto-translated)',
      }),
    ).toBeVisible();
    await screenshot(visitor, 'preview-captions-menu-auto-translated');
  });
});
