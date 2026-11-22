/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, type Page } from '@playwright/test';
import { PORTALS } from './portals.js';
import { screenshot } from './screenshots.js';
import { expectToPlay } from './video.js';

// Steps in the instructor portal's course editor, for scenarios to build on.
// Each waits for what it did to show, so the next step starts from there.

// Creates a course from My Courses and opens its editor.
export const createCourse = async (
  page: Page,
  { title, summary }: { title: string; summary: string },
) => {
  await page.goto(`${PORTALS.instructor}/my-courses`);
  await page.getByRole('button', { name: 'Create course' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a course' });
  await dialog.getByLabel('Course title').fill(title);
  await dialog.getByLabel('Course summary').fill(summary);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(/\/my-courses\/[0-9a-f-]+$/);
  await expect(
    page.getByRole('heading', { level: 1, name: title }),
  ).toBeVisible();
};

export const addModule = async (page: Page, title: string) => {
  await page.getByRole('button', { name: 'New module' }).click();
  const dialog = page.getByRole('dialog', { name: 'New module' });
  await dialog.getByLabel('Module title').fill(title);
  await dialog.getByRole('button', { name: 'Create module' }).click();
  await expect(
    page.getByRole('button', { name: `Hide module ${title}` }),
  ).toBeVisible();
};

// Adds a lesson to the course's only (or last) module.
export const addLesson = async (page: Page, title: string) => {
  await page.getByRole('button', { name: 'New lesson' }).last().click();
  const dialog = page.getByRole('dialog', { name: 'New lesson' });
  await dialog.getByLabel('Lesson title').fill(title);
  await dialog.getByRole('button', { name: 'Create lesson' }).click();
  await expect(
    page.getByRole('button', { name: `Hide lesson ${title}` }),
  ).toBeVisible();
};

// Adds an upload assignment to the course's only (or last) module, through the
// New assignment dialog. `beforeSave` runs with the dialog filled in, for a
// screenshot of it.
export const addUploadAssignment = async (
  page: Page,
  {
    title,
    instructions,
    maxPoints,
    dueAt,
    beforeSave,
  }: {
    title: string;
    instructions: string;
    maxPoints: number;
    // A datetime-local value, e.g. '2099-01-01T09:00'.
    dueAt?: string;
    beforeSave?: () => Promise<void>;
  },
) => {
  await page.getByRole('button', { name: 'New assignment' }).last().click();
  const dialog = page.getByRole('dialog', { name: 'New assignment' });
  await dialog.getByRole('radio', { name: /Upload/ }).check();
  await dialog.getByLabel('Assignment title').fill(title);
  await dialog.getByLabel('Instructions', { exact: true }).fill(instructions);
  await dialog.getByLabel('Max points').fill(String(maxPoints));
  if (dueAt) {
    await dialog.getByLabel('Due date (optional)').fill(dueAt);
  }
  await beforeSave?.();
  await dialog.getByRole('button', { name: 'Create assignment' }).click();
  await expect(
    page.getByRole('button', { name: `Hide assignment ${title}` }),
  ).toBeVisible();
};

// Adds a text item to the last lesson.
export const addTextItem = async (
  page: Page,
  { title, body }: { title: string; body: string },
) => {
  await page.getByRole('button', { name: 'Text', exact: true }).last().click();
  const dialog = page.getByRole('dialog', { name: 'Add text' });
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByLabel('Body', { exact: true }).fill(body);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.getByRole('button', { name: `Hide text ${title}` }),
  ).toBeVisible();
};

export const publishCourse = async (page: Page) => {
  await page.getByRole('button', { name: 'Publish' }).click();
  await page
    .getByRole('alertdialog', { name: 'Publish course' })
    .getByRole('button', { name: 'Publish' })
    .click();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();
};

// Adds a video item to the last lesson, uploading `file`. Its transcode runs
// in the background (locally, ffmpeg in the event runner).
export const addVideoItem = async (
  page: Page,
  { title, file }: { title: string; file: string },
) => {
  await page.getByRole('button', { name: 'Video', exact: true }).last().click();
  const dialog = page.getByRole('dialog', { name: 'Add video' });
  await dialog.getByLabel('Title', { exact: true }).fill(title);
  await dialog.getByLabel('file upload').setInputFiles(file);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.getByRole('button', { name: `Hide video ${title}` }),
  ).toBeVisible();
};

// Adds a file item to the last lesson, uploading `file`, titled with the
// file's name unless `title` is given.
export const addFileItem = async (
  page: Page,
  { title, file }: { title: string; file: string },
) => {
  await page.getByRole('button', { name: 'File', exact: true }).last().click();
  const dialog = page.getByRole('dialog', { name: 'Add file' });
  await dialog.getByLabel('File to attach').setInputFiles(file);
  // Wait for the upload: the dialog then starts the title from the file's
  // name, which this types over.
  const titleField = dialog.getByLabel('Title', { exact: true });
  await expect(titleField).not.toHaveValue('');
  await titleField.fill(title);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.getByRole('button', { name: `Hide file ${title}` }),
  ).toBeVisible();
};

// Opens a video item's editor, which previews it once it's transcoded, and
// waits for the preview to play. The editor fetches the video's state when
// it opens, so this reopens it until the transcode is done.
export const expectVideoPreviewToPlay = async (page: Page, title: string) => {
  const dialog = page.getByRole('dialog', { name: 'Edit video' });
  await expect(async () => {
    if (await dialog.isVisible()) {
      await dialog.getByRole('button', { name: 'Cancel' }).click();
    }
    await page.getByRole('button', { name: `Edit ${title}` }).click();
    await expect(dialog.locator('video')).toBeAttached({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await expectToPlay(dialog.locator('video'));
  await dialog.getByRole('button', { name: 'Cancel' }).click();
};

// Adds a one-question, single-choice quiz to the last lesson, with a limit on
// attempts and the default 70% pass mark. `correct` is the option's text.
export const addQuiz = async (
  page: Page,
  {
    title,
    attempts,
    question,
    options,
    correct,
    settingsScreenshot,
  }: {
    title: string;
    attempts: number;
    // Names a screenshot of the new quiz's settings, taken before they change.
    settingsScreenshot?: string;
    question: string;
    options: [string, string];
    correct: string;
  },
) => {
  await page.getByRole('button', { name: 'Quiz', exact: true }).last().click();
  const dialog = page.getByRole('dialog', { name: 'New quiz' });
  await dialog.getByLabel('Title', { exact: true }).fill(title);
  if (settingsScreenshot) {
    await screenshot(page, settingsScreenshot);
  }
  await dialog.getByRole('checkbox', { name: 'Unlimited' }).uncheck();
  await dialog.getByLabel('Number of attempts').fill(String(attempts));
  await dialog.getByLabel('Question 1', { exact: true }).fill(question);
  for (const [index, option] of options.entries()) {
    await dialog
      .getByLabel(`Option ${index + 1}`, { exact: true })
      .fill(option);
  }
  await dialog
    .getByRole('radio', {
      name: `Option ${options.indexOf(correct) + 1} is correct`,
    })
    .check();
  await dialog.getByRole('button', { name: 'Save quiz' }).click();
  // The editor stays open after saving, saying so.
  await expect(dialog.getByRole('status')).toHaveText('Saved');
  await dialog.getByRole('button', { name: 'Close' }).first().click();
  await expect(
    page.getByRole('button', { name: `Hide quiz ${title}` }),
  ).toBeVisible();
};

// Changes how many attempts the quiz `title` allows, from the course editor.
export const setQuizAttempts = async (
  page: Page,
  title: string,
  attempts: number,
) => {
  await page.getByRole('button', { name: `Edit ${title}` }).click();
  const dialog = page.getByRole('dialog', { name: `Edit ${title}` });
  await dialog.getByLabel('Number of attempts').fill(String(attempts));
  await dialog.getByRole('button', { name: 'Save quiz' }).click();
  // An editing notice is also a status, so look for the "Saved" text itself.
  await expect(dialog.getByText('Saved', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).first().click();
  await expect(dialog).toBeHidden();
};

// Changes the pass mark (a percentage) of the quiz `title`, from the course
// editor.
export const setQuizPassMark = async (
  page: Page,
  title: string,
  percent: number,
) => {
  await page.getByRole('button', { name: `Edit ${title}` }).click();
  const dialog = page.getByRole('dialog', { name: `Edit ${title}` });
  await dialog.getByLabel('Pass mark (%)').fill(String(percent));
  await dialog.getByRole('button', { name: 'Save quiz' }).click();
  await expect(dialog.getByText('Saved', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).first().click();
  await expect(dialog).toBeHidden();
};

// What the course editor calls each kind of content item in its controls'
// names, e.g. "Hide text Reading one".
export type ItemKind =
  | 'text'
  | 'video'
  | 'quiz'
  | 'file'
  | 'lesson'
  | 'assignment';

// Hides a published item from students, confirming in the dialog.
export const hideItem = async (page: Page, kind: ItemKind, title: string) => {
  await page.getByRole('button', { name: `Hide ${kind} ${title}` }).click();
  await page
    .getByRole('alertdialog', { name: `Hide ${kind}` })
    .getByRole('button', { name: `Hide ${kind}`, exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: `Publish ${kind} ${title}` }),
  ).toBeVisible();
};

// Publishes a hidden item to students again, confirming in the dialog.
export const publishItem = async (
  page: Page,
  kind: ItemKind,
  title: string,
) => {
  await page.getByRole('button', { name: `Publish ${kind} ${title}` }).click();
  await page
    .getByRole('alertdialog', { name: `Publish ${kind}` })
    .getByRole('button', { name: `Publish ${kind}`, exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: `Hide ${kind} ${title}` }),
  ).toBeVisible();
};

// Removes an item from a published course, which archives it (a draft's are
// deleted), and waits for it in the archived section.
export const archiveItem = async (
  page: Page,
  kind: ItemKind,
  title: string,
) => {
  await page.getByRole('button', { name: `Remove ${title}` }).click();
  const dialog = page.getByRole('alertdialog', { name: `Archive ${kind}` });
  await dialog.getByRole('button', { name: `Archive ${kind}` }).click();
  await expect(
    page.getByRole('button', { name: `Restore ${kind} ${title}` }),
  ).toBeVisible();
};

// Restores an archived item from the archived section.
export const restoreItem = async (
  page: Page,
  kind: ItemKind,
  title: string,
) => {
  await page.getByRole('button', { name: `Restore ${kind} ${title}` }).click();
  await expect(
    page.getByRole('button', { name: `Restore ${kind} ${title}` }),
  ).toHaveCount(0);
};

// Moves an item one place up in its lesson with the keyboard, as the drag
// handle allows (Space to pick up, an arrow to move, Space to drop).
export const moveItemUp = async (page: Page, title: string) => {
  await page.getByRole('button', { name: `Reorder ${title}` }).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');
};

// The course editor's image preview, once the course has an image.
export const courseImagePreview = (page: Page) =>
  page.locator('img[src*="discava-public-media"]');

// Adds or changes the course's image: uploads `file` in the crop dialog and
// saves it as cropped by default (centred, 16:9). Waits for the preview to
// show an image other than the one there before.
export const setCourseImage = async (page: Page, file: string) => {
  const preview = courseImagePreview(page);
  const before = (await preview.count())
    ? await preview.getAttribute('src')
    : null;
  await page
    .getByRole('button', { name: /^(Add image|Change image)$/ })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Course image' });
  await dialog.getByLabel('Course image file').setInputFiles(file);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(preview).toHaveAttribute('src', /discava-public-media/);
  if (before) {
    await expect(preview).not.toHaveAttribute('src', before);
  }
};

// Removes the course's image.
export const removeCourseImage = async (page: Page) => {
  await page.getByRole('button', { name: 'Change image' }).click();
  const dialog = page.getByRole('dialog', { name: 'Course image' });
  await dialog.getByRole('button', { name: 'Remove image' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('No course image')).toBeVisible();
};

// A published course with one module and one lesson holding `readings` (text
// items), for scenarios that need a course to take rather than to build.
export const createPublishedCourse = async (
  page: Page,
  { title, readings }: { title: string; readings: string[] },
) => {
  await createCourse(page, {
    title,
    summary: 'A course made by the end-to-end tests.',
  });
  await addModule(page, 'Module one');
  await addLesson(page, 'Lesson one');
  for (const reading of readings) {
    await addTextItem(page, { title: reading, body: `${reading}.` });
  }
  await publishCourse(page);
};
