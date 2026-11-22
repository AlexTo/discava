/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { type ApiUser, textBody } from './api.js';
import { WORKSHEET_PDF } from './files.js';
import { THREE_SECOND_VIDEO } from './video.js';

// Steps for free preview lessons, for scenarios to build on.

// A lesson's row in the instructor portal's course editor, found by its title.
export const lessonRow = (page: Page, title: string) =>
  page
    .locator('article')
    .filter({ has: page.getByText(title, { exact: true }) })
    .first();

// Marks the lesson as a free preview through the confirmation dialog. `beforeConfirm`
// runs with the dialog open, for a screenshot of it.
export const markFreePreview = async (
  page: Page,
  title: string,
  { beforeConfirm }: { beforeConfirm?: () => Promise<void> } = {},
) => {
  await lessonRow(page, title)
    .getByRole('button', { name: 'Make free preview' })
    .click();
  const dialog = page.getByRole('alertdialog', { name: 'Make free preview' });
  await expect(dialog).toContainText('Quizzes stay locked.');
  await beforeConfirm?.();
  await dialog.getByRole('button', { name: 'Make free preview' }).click();
  await expect(
    lessonRow(page, title).getByRole('button', {
      name: 'Remove free preview',
    }),
  ).toBeVisible();
};

// Removes the lesson's mark, which takes effect at once.
export const removeFreePreview = async (page: Page, title: string) => {
  await lessonRow(page, title)
    .getByRole('button', { name: 'Remove free preview' })
    .click();
  await expect(
    lessonRow(page, title).getByRole('button', { name: 'Make free preview' }),
  ).toBeVisible();
};

// A lesson with a video (transcoded and ready), a text, a file and a quiz,
// built through instructor-api.
const addLessonWithItems = async (
  instructor: ApiUser,
  module: { courseId: string; moduleId: string },
  title: string,
) => {
  const api = instructor.instructor;
  const { lessonId } = await api.lesson.create.mutate({ ...module, title });
  const lesson = { ...module, lessonId };

  const target = await api.contentItem.createVideoUploadUrl.mutate({
    ...lesson,
    fileName: 'three-seconds.mp4',
  });
  const put = await fetch(target.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4' },
    body: new Uint8Array(await readFile(THREE_SECOND_VIDEO)),
  });
  if (!put.ok) {
    throw new Error(`Uploading the video failed: ${put.status}`);
  }
  const video = { ...lesson, contentItemId: target.contentItemId };
  await api.contentItem.createVideo.mutate({
    ...video,
    title: `${title} video`,
    objectKey: target.objectKey,
    mimeType: 'video/mp4',
  });

  const pdf = await readFile(WORKSHEET_PDF);
  const fileTarget = await api.contentItem.createFileUploadUrl.mutate({
    ...lesson,
    fileName: 'worksheet.pdf',
    fileSize: pdf.byteLength,
  });
  const filePut = await fetch(fileTarget.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: new Uint8Array(pdf),
  });
  if (!filePut.ok) {
    throw new Error(`Uploading the file failed: ${filePut.status}`);
  }
  const file = { ...lesson, contentItemId: fileTarget.contentItemId };
  await api.contentItem.createFile.mutate({
    ...file,
    title: `${title} worksheet`,
    objectKey: fileTarget.objectKey,
    fileName: 'worksheet.pdf',
  });

  const { contentItemId: textId } = await api.contentItem.createText.mutate({
    ...lesson,
    title: `${title} reading`,
    body: textBody(`${title} text body`),
  });
  const { contentItemId: hiddenId } = await api.contentItem.createText.mutate({
    ...lesson,
    title: `${title} hidden reading`,
    body: textBody('Hidden text'),
  });
  await api.contentItem.hide.mutate({ ...lesson, contentItemId: hiddenId });
  const { contentItemId: quizId } = await api.contentItem.createQuiz.mutate({
    ...lesson,
    title: `${title} quiz`,
    questions: [
      {
        questionId: 'q1',
        kind: 'single',
        prompt: textBody('One plus one?'),
        options: [
          { optionId: 'a', text: '2' },
          { optionId: 'b', text: '3' },
        ],
      },
    ],
    answerKey: { q1: { correctOptionIds: ['a'] } },
    settings: {
      passMarkPercent: 100,
      attemptsAllowed: 2,
      shuffleOptions: false,
      revealAnswers: 'never',
    },
  });

  // The transcode is not found until it is done.
  await expect
    .poll(
      () =>
        api.contentItem.createVideoUrl
          .query(video)
          .then(() => true)
          .catch(() => false),
      { timeout: 120_000 },
    )
    .toBe(true);

  return {
    ...lesson,
    video,
    file,
    text: { ...lesson, contentItemId: textId },
    hidden: { ...lesson, contentItemId: hiddenId },
    quiz: { ...lesson, contentItemId: quizId },
  };
};

// A course with one module holding a lesson
// that is a free preview and one that is not, each holding a ready video, a
// text, a file, a quiz and a hidden text. The course is published.
export const createFreePreviewCourseViaApi = async (
  instructor: ApiUser,
  title: string,
) => {
  const api = instructor.instructor;
  const { courseId } = await api.course.create.mutate({ title });
  const { moduleId } = await api.module.create.mutate({
    courseId,
    title: 'Module 1',
  });
  const module = { courseId, moduleId };
  const open = await addLessonWithItems(instructor, module, 'Open');
  const locked = await addLessonWithItems(instructor, module, 'Locked');
  await api.lesson.setFreePreview.mutate({
    courseId,
    moduleId,
    lessonId: open.lessonId,
    freePreview: true,
  });
  await api.course.publish.mutate({ courseId });
  return { courseId, moduleId, open, locked };
};
