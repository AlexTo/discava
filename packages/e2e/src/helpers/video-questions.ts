/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, type Locator, type Page } from '@playwright/test';
import type { ApiUser } from './api.js';

/**
 * Opens a video row's Questions dialog. The button is disabled until the
 * course view knows the video is ready, so this reloads the page until it is
 * enabled.
 */
export const openVideoQuestions = async (
  page: Page,
  videoTitle: string,
): Promise<Locator> => {
  const button = page.getByRole('button', {
    // "Questions for <title>", or "Questions (N) for <title>" once it has some.
    name: new RegExp(
      `^Questions( \\(\\d+\\))? for ${videoTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
    ),
  });
  await expect(async () => {
    if (!(await button.isEnabled())) {
      await page.reload();
    }
    await expect(button).toBeEnabled({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Questions' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('video')).toBeAttached();
  return dialog;
};

/**
 * Moves the player to `seconds` and waits for the editor to show it as the
 * current time, which is what **Add a question here** takes.
 */
export const seekTo = async (dialog: Locator, seconds: number) => {
  await dialog.locator('video').evaluate((v: HTMLVideoElement, to) => {
    v.currentTime = to;
  }, seconds);
  await expect(
    dialog.getByText(`Current time 0:${String(seconds).padStart(2, '0')}`),
  ).toBeVisible();
};

/** Fills the open question card: its prompt, two options and the correct one. */
export const fillVideoQuestion = async (
  dialog: Locator,
  number: number,
  {
    question,
    options,
    correct,
  }: { question: string; options: [string, string]; correct: string },
) => {
  await dialog.getByLabel(`Question ${number}`, { exact: true }).fill(question);
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
};

/** Adds a question at the player's current time, and fills it in. */
export const addQuestionHere = async (
  dialog: Locator,
  number: number,
  question: Parameters<typeof fillVideoQuestion>[2],
) => {
  await dialog.getByRole('button', { name: 'Add a question here' }).click();
  await fillVideoQuestion(dialog, number, question);
};

/** Adds an end question, and fills it in. */
export const addEndQuestion = async (
  dialog: Locator,
  number: number,
  question: Parameters<typeof fillVideoQuestion>[2],
) => {
  await dialog.getByRole('button', { name: 'Add an end question' }).click();
  await fillVideoQuestion(dialog, number, question);
};

/** Saves the questions and waits for the editor to say so. */
export const saveVideoQuestions = async (dialog: Locator) => {
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByText('Saved', { exact: true })).toBeVisible();
};

const textBody = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

/** A video question as the API takes it, with the answer key's part inline. */
export interface ApiVideoQuestion {
  questionId: string;
  prompt: string;
  options: [string, string];
  /** Index (0 or 1) of the correct option. */
  correct: 0 | 1;
  /** Whole seconds into the video; null asks it after the video ends. */
  atSeconds: number | null;
  explanation?: string;
}

/**
 * Saves a video's questions through instructor-api, as the editor would.
 * `quizVersion` is the version the video is at: 0 before it has any.
 */
export const setVideoQuestionsViaApi = (
  instructor: ApiUser,
  item: {
    courseId: string;
    moduleId: string;
    lessonId: string;
    contentItemId: string;
  },
  questions: ApiVideoQuestion[],
  quizVersion = 0,
) =>
  instructor.instructor.contentItem.updateVideoQuestions.mutate({
    ...item,
    quizVersion,
    questions: questions.map((q) => ({
      questionId: q.questionId,
      kind: 'single' as const,
      prompt: textBody(q.prompt),
      options: q.options.map((text, index) => ({
        optionId: `${q.questionId}-${index}`,
        text,
      })),
      atSeconds: q.atSeconds,
    })),
    answerKey: Object.fromEntries(
      questions.map((q) => [
        q.questionId,
        {
          correctOptionIds: [`${q.questionId}-${q.correct}`],
          ...(q.explanation && { explanation: textBody(q.explanation) }),
        },
      ]),
    ),
  });

/** The question the player has open over the video. */
export const openVideoQuestion = (page: Page) =>
  page.getByRole('group', { name: 'Video question' });
