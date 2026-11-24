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
  openCaptionsDialog,
  openCaptionsMenu,
  removeCaptionLanguages,
  shownCue,
  translatedCourse,
  uploadCaption,
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
import { waitForQueuesToDrain } from '../helpers/router.js';
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

    const captions = visitor.getByRole('button', { name: /^Captions/ });
    // The player reads the preview's tracks once, when it opens, and the
    // translations arrive after the automatic captions do: open the page
    // afresh until they are there.
    await expect(async () => {
      await visitor.goto(coursePageUrl(courseId));
      await visitor.getByRole('button', { name: 'Play preview' }).click();
      await expectToPlay(visitor.locator('video[data-slot="hls-video"]'));
      await captions.click();
      await expect(
        visitor.getByRole('menuitemradio', {
          name: 'Español (auto-translated)',
        }),
      ).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 120_000 });
    await expect(
      visitor.getByRole('menuitemradio', {
        name: 'Français (auto-translated)',
      }),
    ).toBeVisible();
    await screenshot(visitor, 'preview-captions-menu-auto-translated');
  });
});

test('translations follow the source', async ({ browser }) => {
  const instructor = await browser.newPage();
  const student = await browser.newPage();
  const NEW_CUE = 'A different English cue.';
  const { course, courseId } = await translatedCourse(
    instructor,
    student,
    uniqueName('E2E translations follow'),
  );

  await test.step('replacing the source re-translates French', async () => {
    await uploadCaption(instructor, 'Video one', {
      tag: 'en-US',
      cue: NEW_CUE,
    });
    await closeDialog(instructor);
    await expectCaptionTrackListed(instructor, 'Video one', 'Français');
    await closeDialog(instructor);

    // The student's player reads the tracks when it opens: look again until
    // the French track carries the new cue.
    await expect(async () => {
      await student.reload();
      const video = lessonVideo(student, 'Video one');
      await openCaptionsMenu(student, 'Video one');
      await student
        .getByRole('menuitemradio', { name: 'Français (auto-translated)' })
        .click();
      await expect
        .poll(() => shownCue(video), { timeout: 5_000 })
        .toBe(LOCAL_TRANSLATION('fr-FR', NEW_CUE));
    }).toPass({ timeout: 90_000 });
  });

  await test.step('removing French from the course removes it from the videos', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses/${courseId}`);
    await removeCaptionLanguages(instructor, course, ['French']);

    await expect(async () => {
      const dialog = await openCaptionsDialog(instructor, 'Video one');
      try {
        await expect(
          dialog.getByRole('listitem', { name: 'Français' }),
        ).toHaveCount(0, { timeout: 3_000 });
      } catch (error) {
        await closeDialog(instructor);
        throw error;
      }
    }).toPass({ timeout: 60_000 });
    const dialog = instructor.getByRole('dialog', { name: 'Captions' });
    await expect(
      dialog.getByRole('listitem', { name: 'Español' }),
    ).toBeVisible();
    await screenshot(instructor, 'captions-language-removed');
    await closeDialog(instructor);
  });

  await test.step('renaming the video changes no track', async () => {
    await instructor.getByRole('button', { name: 'Edit Video one' }).click();
    const edit = instructor.getByRole('dialog', { name: 'Edit video' });
    await edit.getByLabel('Title', { exact: true }).fill('Video renamed');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(
      instructor.getByRole('button', { name: 'Hide video Video renamed' }),
    ).toBeVisible();
    // Give the stream time to deliver the change before looking.
    await waitForQueuesToDrain();

    const dialog = await openCaptionsDialog(instructor, 'Video renamed');
    await expect(dialog.getByRole('listitem')).toHaveCount(2);
    await expect(
      dialog.getByRole('listitem', { name: 'Español' }),
    ).toBeVisible();
    await closeDialog(instructor);
  });
});

test('a course in Spanish with only English automatic captions is not translated', async ({
  browser,
}) => {
  const instructor = await browser.newPage();
  const course = uniqueName('E2E language mismatch');

  await instructor.goto(`${PORTALS.instructor}/my-courses`);
  await signIn(instructor, newUser('Tess', ['instructor']));
  await createCourse(instructor, {
    title: course,
    summary: 'A Spanish course with English automatic captions.',
  });
  await instructor.getByLabel('Language', { exact: true }).selectOption('es');
  await instructor
    .getByRole('button', { name: 'Save catalogue details' })
    .click();
  await expect(instructor.getByText('Saved').first()).toBeVisible();
  await chooseCaptionLanguages(instructor, course, ['French']);
  await addModule(instructor, 'Module one');
  await addLesson(instructor, 'Lesson one');
  await addVideoItem(instructor, {
    title: 'Video one',
    file: THREE_SECOND_VIDEO,
  });
  await expectCaptionTrackListed(instructor, 'Video one', 'English');

  const dialog = instructor.getByRole('dialog', { name: 'Captions' });
  await expect(
    dialog.getByText(
      "French: The automatic captions aren't in the course's language. Upload captions in the video's language to translate them.",
    ),
  ).toBeVisible();
  await expect(dialog.getByRole('listitem', { name: 'Français' })).toHaveCount(
    0,
  );
  await screenshot(instructor, 'captions-dialog-language-mismatch');
  await closeDialog(instructor);
});
