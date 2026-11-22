/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { apiUser, createCaptionedVideoViaApi } from '../helpers/api.js';
import {
  addLesson,
  addModule,
  addVideoItem,
  createCourse,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import {
  enrol,
  lessonItem,
  lessonVideo,
  markItemDone,
  openCourse,
  startFirstLesson,
} from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';
import { THREE_SECOND_VIDEO } from '../helpers/video.js';
import {
  addEndQuestion,
  addQuestionHere,
  openVideoQuestion,
  openVideoQuestions,
  saveVideoQuestions,
  seekTo,
  setVideoQuestionsViaApi,
} from '../helpers/video-questions.js';

// Questions on a video's timeline: an instructor adds one at a moment of the
// video and one for the end, saves, and finds both after a reload.
test('an instructor adds questions to a video', async ({ browser }) => {
  const instructor = await browser.newPage();

  await instructor.goto(`${PORTALS.instructor}/my-courses`);
  await signIn(instructor, newUser('Ivy', ['instructor']));
  await createCourse(instructor, {
    title: uniqueName('E2E video questions course'),
    summary: 'A course with video questions, made by the end-to-end tests.',
  });
  await addModule(instructor, 'Module one');
  await addLesson(instructor, 'Lesson one');
  await addVideoItem(instructor, {
    title: 'Video one',
    file: THREE_SECOND_VIDEO,
  });

  await test.step('the instructor adds a question at 0:01 and an end question', async () => {
    const dialog = await openVideoQuestions(instructor, 'Video one');
    await seekTo(dialog, 1);
    await addQuestionHere(dialog, 1, {
      question: 'What is on screen?',
      options: ['Colour bars', 'A cat'],
      correct: 'Colour bars',
    });
    await expect(
      dialog.getByRole('textbox', { name: 'Ask at, question 1' }),
    ).toHaveValue('0:01');
    await addEndQuestion(dialog, 2, {
      question: 'Did you enjoy it?',
      options: ['Yes', 'No'],
      correct: 'Yes',
    });
    await screenshot(instructor, 'video questions editor');
    await saveVideoQuestions(dialog);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step('after a reload both are there, and the row counts them', async () => {
    await instructor.reload();
    const row = instructor.getByRole('button', {
      name: 'Questions for Video one',
    });
    await expect(row).toHaveText('Questions (2)');
    await screenshot(instructor, 'video row with question count');

    const dialog = await openVideoQuestions(instructor, 'Video one');
    await expect(
      dialog.getByRole('textbox', { name: 'Ask at, question 1' }),
    ).toHaveValue('0:01');
    await expect(
      dialog.getByRole('switch', { name: 'At the end, question 2' }),
    ).toBeChecked();
    await dialog.getByRole('button', { name: 'Expand Question 1' }).click();
    // The prompt is a rich text editor, not an input: read its text.
    await expect(
      dialog.getByLabel('Question 1', { exact: true }),
    ).toContainText('What is on screen?');
  });

  await test.step('Preview as student asks the question at 0:01, graded in the browser', async () => {
    const dialog = instructor.getByRole('dialog', { name: 'Questions' });
    await dialog.getByRole('button', { name: 'Preview as student' }).click();
    const preview = dialog.getByRole('region', { name: 'Student preview' });
    await preview.getByRole('button', { name: 'Play', exact: true }).click();
    const question = preview.getByRole('group', { name: 'Video question' });
    await expect(question).toBeVisible({ timeout: 15_000 });
    await question.getByRole('radio', { name: 'Colour bars' }).check();
    await question.getByRole('button', { name: 'Submit answer' }).click();
    await expect(question.getByRole('status')).toContainText('Correct');
    await screenshot(instructor, 'video questions preview');
  });
});

// A learner is stopped by a question at 0:01, answers it wrongly, reads why
// and carries on to the end. Answering is not completing: the video is still
// to be marked as done, as for a video without questions.
test('a learner is asked a video question, answers it and carries on', async ({
  page,
}) => {
  const title = uniqueName('E2E asked a video question');
  const instructor = await apiUser('Ivy', ['instructor']);
  const video = await createCaptionedVideoViaApi(instructor, title);
  await setVideoQuestionsViaApi(instructor, video, [
    {
      questionId: 'q1',
      prompt: 'What is on screen?',
      options: ['Colour bars', 'A cat'],
      correct: 0,
      atSeconds: 1,
      explanation: 'The test video is a set of colour bars',
    },
  ]);
  await instructor.instructor.course.publish.mutate({
    courseId: video.courseId,
  });

  await openCourse(page, title);
  await enrol(page, newUser('Sam', ['student']));
  await startFirstLesson(page);

  const player = page.getByRole('group', { name: 'Video player' });
  await player.getByRole('button', { name: 'Play', exact: true }).click();

  const question = openVideoQuestion(page);
  await test.step('the video pauses at 0:01 with the question focused', async () => {
    await expect(question).toBeVisible({ timeout: 15_000 });
    await expect(
      question.getByRole('heading', { name: 'Question at 0:01' }),
    ).toBeFocused();
    await expect(
      lessonVideo(page, 'Video').evaluate((v: HTMLVideoElement) => v.paused),
    ).resolves.toBe(true);
    await screenshot(page, 'video question open');
  });

  await test.step('a wrong answer shows the correct option and the explanation', async () => {
    await question.getByRole('radio', { name: 'A cat' }).check();
    await question.getByRole('button', { name: 'Submit answer' }).click();
    await expect(question.getByRole('status')).toContainText('Not quite');
    // The option marked as correct, whatever else its row says.
    await expect(
      question.getByRole('listitem').filter({ hasText: '(correct answer)' }),
    ).toContainText('Colour bars');
    await expect(
      question.getByText('The test video is a set of colour bars'),
    ).toBeVisible();
    await screenshot(page, 'video question answered');
  });

  await test.step('Continue resumes the video to the end', async () => {
    await question.getByRole('button', { name: 'Continue' }).click();
    await expect(question).toBeHidden();
    await expect
      .poll(
        () =>
          lessonVideo(page, 'Video').evaluate((v: HTMLVideoElement) => v.ended),
        { timeout: 15_000 },
      )
      .toBe(true);
    await expect(question).toBeHidden();
  });

  await test.step('the video is still to be marked as done, as without questions', async () => {
    const item = lessonItem(page, 'Video');
    await expect(item.getByText('Done', { exact: true })).toBeHidden();
    await markItemDone(page, 'Video');
  });
});

// Seeking past a question doesn't stop the video for it; its marker on the
// seek bar opens it, for an answer first and for review and practice after.
test('a learner seeks past a question and opens it from its marker', async ({
  page,
}) => {
  const title = uniqueName('E2E video question markers');
  const instructor = await apiUser('Ivy', ['instructor']);
  const video = await createCaptionedVideoViaApi(instructor, title);
  const colourBars = {
    questionId: 'q1',
    prompt: 'What is on screen?',
    options: ['Colour bars', 'A cat'] as [string, string],
    atSeconds: 1,
    explanation: 'The test video is a set of colour bars',
  };
  await setVideoQuestionsViaApi(instructor, video, [
    { ...colourBars, correct: 0 },
  ]);
  await instructor.instructor.course.publish.mutate({
    courseId: video.courseId,
  });

  await openCourse(page, title);
  await enrol(page, newUser('Sam', ['student']));
  await startFirstLesson(page);

  const player = page.getByRole('group', { name: 'Video player' });
  const unanswered = player.getByRole('button', {
    name: 'Question at 0:01, not answered',
  });
  const question = openVideoQuestion(page);

  await test.step('seeking to the end asks nothing, and the marker shows', async () => {
    await lessonVideo(page, 'Video').evaluate((v: HTMLVideoElement) => {
      v.currentTime = v.duration;
    });
    await expect(unanswered).toBeVisible();
    await expect(question).toBeHidden();
    await screenshot(page, 'seek bar with question markers');
  });

  await test.step('the marker opens the question, and answering it is recorded', async () => {
    await unanswered.click();
    await expect(question).toBeVisible();
    await question.getByRole('radio', { name: 'A cat' }).check();
    await question.getByRole('button', { name: 'Submit answer' }).click();
    await expect(question.getByRole('status')).toContainText('Not quite');
    await question.getByRole('button', { name: 'Close' }).click();
    await expect(question).toBeHidden();
  });

  await test.step('reviewing it shows the answer, and Try again records nothing', async () => {
    await player
      .getByRole('button', { name: 'Question at 0:01, answered' })
      .click();
    await expect(question.getByRole('status')).toContainText('Not quite');
    await screenshot(page, 'reviewing an answered question');
    await question.getByRole('button', { name: 'Try again' }).click();
    await expect(
      question.getByText("Practice: this answer isn't recorded"),
    ).toBeVisible();
    await question.getByRole('radio', { name: 'Colour bars' }).check();
    await question.getByRole('button', { name: 'Check answer' }).click();
    await expect(question.getByRole('status')).toContainText('Correct');
    await question.getByRole('button', { name: 'Close' }).click();
    await expect(question).toBeHidden();
  });

  await test.step('after a reload the marker is answered and playing through 0:01 does not pause', async () => {
    await page.reload();
    const answered = player.getByRole('button', {
      name: 'Question at 0:01, answered',
    });
    await expect(answered).toBeVisible();
    await lessonVideo(page, 'Video').evaluate((v: HTMLVideoElement) => {
      v.currentTime = 0;
    });
    await player.getByRole('button', { name: 'Play', exact: true }).click();
    await expect
      .poll(
        () =>
          lessonVideo(page, 'Video').evaluate((v: HTMLVideoElement) => v.ended),
        { timeout: 15_000 },
      )
      .toBe(true);
    await expect(question).toBeHidden();
  });

  await test.step('a changed answer key shows in the review, the learner’s result stays', async () => {
    await setVideoQuestionsViaApi(
      instructor,
      video,
      [{ ...colourBars, correct: 1 }],
      1,
    );
    await page.reload();
    await player
      .getByRole('button', { name: 'Question at 0:01, answered' })
      .click();
    await expect(question.getByRole('status')).toContainText('Not quite');
    await expect(
      question.getByRole('listitem').filter({ hasText: '(correct answer)' }),
    ).toContainText('A cat');
  });

  await test.step('a video a learner has used cannot be deleted permanently', async () => {
    await instructor.instructor.contentItem.delete.mutate(video);
    await expect(
      instructor.instructor.contentItem.deletePermanently.mutate(video),
    ).rejects.toMatchObject({ data: { code: 'PRECONDITION_FAILED' } });
  });
});

// A video with questions for the end asks them by itself when it finishes, one
// after another. The learner answers one, skips the other and reads the
// summary, which counts the questions answered so far.
test('a learner takes the check at the end of a video', async ({ page }) => {
  const title = uniqueName('E2E end of video check');
  const instructor = await apiUser('Ivy', ['instructor']);
  const video = await createCaptionedVideoViaApi(instructor, title);
  await setVideoQuestionsViaApi(instructor, video, [
    {
      questionId: 'e1',
      prompt: 'What is on screen?',
      options: ['Colour bars', 'A cat'],
      correct: 0,
      atSeconds: null,
    },
    {
      questionId: 'e2',
      prompt: 'Did you enjoy it?',
      options: ['Yes', 'No'],
      correct: 0,
      atSeconds: null,
    },
  ]);
  await instructor.instructor.course.publish.mutate({
    courseId: video.courseId,
  });

  await openCourse(page, title);
  await enrol(page, newUser('Sam', ['student']));
  await startFirstLesson(page);

  const player = page.getByRole('group', { name: 'Video player' });
  await player.getByRole('button', { name: 'Play', exact: true }).click();
  const question = openVideoQuestion(page);

  await test.step('the first question appears by itself when the video ends', async () => {
    await expect(question).toBeVisible({ timeout: 15_000 });
    await expect(
      question.getByRole('heading', { name: 'Question 1 of 2' }),
    ).toBeFocused();
    await expect(question.getByText('What is on screen?')).toBeVisible();
    await screenshot(page, 'end of video check');
  });

  await test.step('answering one and skipping the other ends in the summary', async () => {
    await question.getByRole('radio', { name: 'Colour bars' }).check();
    await question.getByRole('button', { name: 'Submit answer' }).click();
    await expect(question.getByRole('status')).toContainText('Correct');
    await question.getByRole('button', { name: 'Continue' }).click();
    await expect(
      question.getByRole('heading', { name: 'Question 2 of 2' }),
    ).toBeVisible();
    await question.getByRole('button', { name: 'Skip' }).click();
    await expect(
      page.getByRole('heading', { name: '1 of 1 correct' }),
    ).toBeVisible();
    await screenshot(page, 'end check summary');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '1 of 1 correct' }),
    ).toBeHidden();
  });

  await test.step('the end marker shows one of two answered, and the video does not play again', async () => {
    await expect(
      player.getByRole('button', {
        name: 'Questions at the end, 1 of 2 answered',
      }),
    ).toBeVisible();
    await expect(
      lessonVideo(page, 'Video').evaluate((v: HTMLVideoElement) => v.ended),
    ).resolves.toBe(true);
  });

  await test.step('Mark as done still completes the video', async () => {
    await markItemDone(page, 'Video');
  });
});
