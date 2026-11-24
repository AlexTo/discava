/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Locator } from '@playwright/test';
import {
  CAPTION_CUE,
  chooseCaptionLanguages,
  closeDialog,
  expectCaptionTrackListed,
  openCaptionsDialog,
  openCaptionsMenu,
  removeCaption,
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
import { waitForQueuesToDrain } from '../helpers/router.js';
import { screenshot } from '../helpers/screenshots.js';
import {
  enrol,
  lessonVideo,
  openCourse,
  startFirstLesson,
} from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';
import { expectToPlay, THREE_SECOND_VIDEO } from '../helpers/video.js';

// Split from caption-translation.e2e.ts so the two run on different CI shards
// (helpers/shards.ts): what a viewer gets when a translation is replaced by an
// uploaded track, or fails.

test('an uploaded track replaces a translation and survives', async ({
  browser,
}) => {
  const instructor = await browser.newPage();
  const student = await browser.newPage();
  await translatedCourse(instructor, student, uniqueName('E2E upload wins'));

  await test.step('an uploaded Spanish file replaces the translated Spanish', async () => {
    const dialog = await uploadCaption(instructor, 'Video one', {
      tag: 'es-ES',
      cue: CAPTION_CUE,
    });
    const spanish = dialog.getByRole('listitem', { name: 'Spanish' });
    await expect(spanish.getByText('Uploaded')).toBeVisible();
    await expect(dialog.getByRole('listitem', { name: 'Español' })).toHaveCount(
      0,
    );
    await screenshot(instructor, 'captions-dialog-upload-replaced-translation');
    await closeDialog(instructor);
  });

  await test.step('the student’s menu offers the uploaded track, unmarked', async () => {
    await student.reload();
    const video = lessonVideo(student, 'Video one');
    await openCaptionsMenu(student, 'Video one');
    await expect(
      student.getByRole('menuitemradio', { name: 'Spanish' }),
    ).toBeVisible();
    await expect(
      student.getByRole('menuitemradio', { name: /Español/ }),
    ).toHaveCount(0);
    await expect(
      student.getByRole('menuitemradio', {
        name: 'Français (auto-translated)',
      }),
    ).toBeVisible();
    await student.getByRole('menuitemradio', { name: 'Spanish' }).click();
    await expect.poll(() => shownCue(video)).toBe(CAPTION_CUE);
  });

  await test.step('a new source keeps the upload and translates French again', async () => {
    const dialog = await uploadCaption(instructor, 'Video one', {
      tag: 'en-US',
      cue: 'A new English cue.',
    });
    await expect(
      dialog.getByRole('listitem', { name: 'English' }).getByText('Uploaded'),
    ).toBeVisible();
    await closeDialog(instructor);

    const again = await expectCaptionTrackListed(
      instructor,
      'Video one',
      'Français',
    );
    await expect(
      again.getByRole('listitem', { name: 'Spanish' }).getByText('Uploaded'),
    ).toBeVisible();
    await expect(again.getByRole('listitem', { name: 'Español' })).toHaveCount(
      0,
    );
    await closeDialog(instructor);
  });

  await test.step('removing the upload brings the translation back', async () => {
    await removeCaption(instructor, 'Video one', 'Spanish');
    await closeDialog(instructor);
    const dialog = await expectCaptionTrackListed(
      instructor,
      'Video one',
      'Español',
    );
    await expect(
      dialog
        .getByRole('listitem', { name: 'Español' })
        .getByText('Auto-translated'),
    ).toBeVisible();
    await closeDialog(instructor);
  });
});

test('a failed translation leaves the video playable', async ({ browser }) => {
  const instructor = await browser.newPage();
  const student = await browser.newPage();
  const course = uniqueName('E2E translation fails');
  const FAILING_CUE = 'This cue fails to translate [[fail-translation:fr-FR]].';

  await test.step('French fails while Spanish is translated', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Tess', ['instructor']));
    await createCourse(instructor, {
      title: course,
      summary: 'A course whose French translation fails.',
    });
    await addModule(instructor, 'Module one');
    await addLesson(instructor, 'Lesson one');
    await addVideoItem(instructor, {
      title: 'Video one',
      file: THREE_SECOND_VIDEO,
    });
    await expectCaptionTrackListed(instructor, 'Video one', 'English');
    await closeDialog(instructor);
    await chooseCaptionLanguages(instructor, course, ['Spanish', 'French']);
    await expectCaptionTrackListed(instructor, 'Video one', 'Français');
    await closeDialog(instructor);

    await uploadCaption(instructor, 'Video one', {
      tag: 'en-US',
      cue: FAILING_CUE,
    });
    await closeDialog(instructor);
    await publishCourse(instructor);

    let dialog: Locator | undefined;
    await expect(async () => {
      dialog = await openCaptionsDialog(instructor, 'Video one');
      try {
        await expect(
          dialog.getByText('French: Translation failed'),
        ).toBeVisible({ timeout: 3_000 });
      } catch (error) {
        await closeDialog(instructor);
        throw error;
      }
    }).toPass({ timeout: 90_000 });
    await expect(
      (dialog as Locator)
        .getByRole('listitem', { name: 'Español' })
        .getByText('Auto-translated'),
    ).toBeVisible();
    await screenshot(instructor, 'captions-dialog-translation-failed');
    await closeDialog(instructor);
  });

  await test.step('the student plays the video with its English and Spanish tracks', async () => {
    await openCourse(student, course);
    await enrol(student, newUser('Sol', ['student']));
    await startFirstLesson(student);
    await expectToPlay(lessonVideo(student, 'Video one'));
    await openCaptionsMenu(student, 'Video one');
    await expect(student.getByRole('menuitemradio')).toHaveText([
      'Off',
      'English (default)',
      'Español (auto-translated)',
    ]);
  });

  await test.step('Translate again runs it again and the row stays failed', async () => {
    const dialog = await openCaptionsDialog(instructor, 'Video one');
    await dialog.getByRole('button', { name: 'Translate again' }).click();
    await waitForQueuesToDrain();
    await expect(dialog.getByText('French: Translation failed')).toBeVisible({
      timeout: 60_000,
    });
    await closeDialog(instructor);
  });

  await test.step('a clean source file produces the French track', async () => {
    await uploadCaption(instructor, 'Video one', {
      tag: 'en-US',
      cue: CAPTION_CUE,
    });
    await closeDialog(instructor);
    const dialog = await expectCaptionTrackListed(
      instructor,
      'Video one',
      'Français',
    );
    await expect(dialog.getByText('French: Translation failed')).toHaveCount(0);
    await closeDialog(instructor);
  });
});
