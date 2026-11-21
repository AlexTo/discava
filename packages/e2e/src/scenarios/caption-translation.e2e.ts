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
import { THREE_SECOND_VIDEO } from '../helpers/video.js';

test('an instructor chooses caption languages and every video gets them', async ({
  browser,
}) => {
  const course = uniqueName('E2E caption languages course');
  const instructor = await browser.newPage();
  const student = await browser.newPage();

  await test.step('the instructor chooses Spanish and French', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Tess', ['instructor']));
    await createCourse(instructor, {
      title: course,
      summary: 'A course translated by the end-to-end tests.',
    });
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

  await test.step('a student picks the Spanish captions', async () => {
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
    await student.getByRole('menuitemradio', { name: /^Español/ }).click();
    await expect
      .poll(() => shownCue(video))
      .toBe(LOCAL_TRANSLATION('es-ES', AUTO_CAPTION_CUE));
    await screenshot(student, 'student-translated-captions');
  });
});
