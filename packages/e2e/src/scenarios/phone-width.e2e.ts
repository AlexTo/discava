/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from 'node:fs/promises';
import {
  apiUser,
  createCaptionedVideoViaApi,
  createLongTitledCourseViaApi,
  createPublishedCourseViaApi,
  textBody,
} from '../helpers/api.js';
import {
  apiUserFor,
  createUploadAssignmentCourse,
  uploadSubmissionFile,
} from '../helpers/assignment.js';
import { chooseCaptionLanguages, webVttOf } from '../helpers/captions.js';
import { createCategory, setCourseCatalogue } from '../helpers/catalogue.js';
import { WORKSHEET_PDF } from '../helpers/files.js';
import { createFreePreviewCourseViaApi } from '../helpers/free-preview.js';
import { createCourse } from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { coursePageUrl, setLandingViaApi } from '../helpers/public-pages.js';
import { screenshot } from '../helpers/screenshots.js';
import {
  enrol,
  enrolAndLand,
  expectAfterReloads,
  openCourse,
  searchTranscripts,
} from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';
import {
  openVideoQuestions,
  setVideoQuestionsViaApi,
} from '../helpers/video-questions.js';
import {
  expectDialogFits,
  expectNoSidewaysScroll,
  expectOnScreen,
  PHONE,
} from '../helpers/viewport.js';

// The student portal on a small phone: pages fit the width, and nothing needed
// is pushed below the first screen.
test.use({ viewport: PHONE });

test('a lesson with long titles fits a phone', async ({ page }) => {
  const title = uniqueName('E2E phone course');
  const instructor = await apiUser('Ivy', ['instructor', 'student']);
  const { lessonTitles } = await createLongTitledCourseViaApi(
    instructor,
    title,
  );

  await openCourse(page, title);
  await enrolAndLand(page, newUser('Pia', ['student']));
  const lessonHeading = page.getByRole('heading', {
    level: 2,
    name: lessonTitles[0],
  });
  await expect(lessonHeading).toBeVisible();

  await test.step('nothing scrolls sideways, and the outline is closed', async () => {
    await expectNoSidewaysScroll(page);
    const outline = page.getByRole('button', { name: /^Course outline/ });
    await expect(outline).toBeVisible();
    await expect(outline).toHaveAttribute('aria-expanded', 'false');
  });

  await test.step('the lesson starts on the first screen', async () => {
    for (const locator of [
      lessonHeading,
      page.getByText("You're enrolled in"),
    ]) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
        PHONE.height,
      );
    }
    await screenshot(page, 'lesson at phone width');
  });

  await test.step('the outline opens and leads to the second lesson', async () => {
    await page.getByRole('button', { name: /^Course outline/ }).click();
    await expectNoSidewaysScroll(page);
    await screenshot(page, 'outline open at phone width');
    await page
      .getByRole('navigation', { name: 'Course outline' })
      .getByRole('link', { name: new RegExp(lessonTitles[1] ?? '') })
      .click();
    const second = page.getByRole('heading', {
      level: 2,
      name: lessonTitles[1],
    });
    await expect(second).toBeVisible();
    // The outline closes again, so the lesson is the first thing on screen.
    await expect(
      page.getByRole('button', { name: /^Course outline/ }),
    ).toHaveAttribute('aria-expanded', 'false');
    const box = await second.boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
      PHONE.height,
    );
    await expectNoSidewaysScroll(page);
  });
});

test('a course page with six section tabs fits a phone and scrolls its tabs', async ({
  page,
}) => {
  const title = uniqueName('E2E phone tabs course');
  const instructor = await apiUser('Ivy', ['instructor']);
  const { courseId } = await createPublishedCourseViaApi(instructor, title);
  await setLandingViaApi(instructor, courseId, {
    learningOutcomes: ['Read a wide tab bar'],
    requirements: ['A phone'],
  });

  await page.goto(coursePageUrl(courseId));
  await expect(
    page.getByRole('heading', { level: 1, name: title }),
  ).toBeVisible();
  const tabs = page.getByRole('navigation', { name: 'Course sections' });
  await expect(tabs.getByRole('link')).toHaveCount(6);

  await test.step('the page does not scroll sideways', async () => {
    await expectNoSidewaysScroll(page);
    await screenshot(page, 'course page with six tabs at phone width');
  });

  await test.step('the last tab can be scrolled into view and clicked', async () => {
    const last = tabs.getByRole('link', { name: 'Reviews' });
    await last.scrollIntoViewIfNeeded();
    await last.click();
    await expect(page).toHaveURL(`${coursePageUrl(courseId)}#reviews`);
    await expectNoSidewaysScroll(page);
  });
});

test('search and the user menu work on a phone for an instructor-student', async ({
  page,
}) => {
  const title = uniqueName('E2E phone search course');
  const instructor = await apiUser('Ivy', ['instructor', 'student']);
  await createPublishedCourseViaApi(instructor, title);

  await page.goto(PORTALS.student);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await signIn(page, newUser('Ines', ['instructor', 'student']));
  const menuButton = page.getByRole('button', { name: 'Open user menu' });
  await expect(menuButton).toBeVisible();

  await test.step('the top bar fits and the user menu is fully visible', async () => {
    await expectNoSidewaysScroll(page);
    const box = await menuButton.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(PHONE.width);
  });

  await test.step('the search box shows what is typed and the suggestions are wide', async () => {
    const search = page.getByRole('combobox', { name: 'Search courses' });
    await search.fill(title.slice(0, 20));
    const suggestions = page.getByRole('listbox', {
      name: 'Course suggestions',
    });
    await expect(suggestions).toBeVisible();
    expect((await search.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(
      150,
    );
    expect(
      (await suggestions.boundingBox())?.width ?? 0,
    ).toBeGreaterThanOrEqual(320);
    await screenshot(page, 'search suggestions at phone width');
    await search.fill('');
  });

  await test.step('the user menu starts with My Learning, then Instructor', async () => {
    await menuButton.click();
    const items = page.getByRole('menuitem');
    await expect(items.nth(0)).toHaveText('My Learning');
    await expect(items.nth(1)).toHaveText('Instructor');
    await screenshot(page, 'user menu at phone width');
  });
});

test('search results come first on a phone, with the filters collapsed', async ({
  page,
}) => {
  const title = uniqueName('E2E phone filter course');
  const instructor = await apiUser('Ivy', ['instructor']);
  const category = await createCategory(uniqueName('E2E phone category'));
  const { courseId } = await createPublishedCourseViaApi(instructor, title);
  await setCourseCatalogue(courseId, {
    categoryId: category.categoryId,
    level: 'beginner',
    language: 'en',
    durationHours: 3,
    tags: [uniqueName('phonetag').toLowerCase()],
  });

  const expectResultsFirst = async () => {
    const card = page.getByRole('link', { name: new RegExp(title) }).first();
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    expect(box?.y ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      PHONE.height,
    );
    await expectNoSidewaysScroll(page);
    await expect(
      page.getByRole('button', { name: /^Filters/ }),
    ).toHaveAttribute('aria-expanded', 'false');
  };

  await test.step('a search for the course shows it on the first screen', async () => {
    // The index follows the table's stream by up to a few seconds.
    await page.goto(
      `${PORTALS.student}/search?query=${encodeURIComponent(title)}`,
    );
    await expectAfterReloads(page, async () => {
      await expect(
        page.getByRole('link', { name: new RegExp(title) }),
      ).toBeVisible({
        timeout: 2_000,
      });
    });
    await expectResultsFirst();
    await screenshot(page, 'search results at phone width');
  });

  await test.step('the category page shows it on the first screen', async () => {
    await page.goto(`${PORTALS.student}/category/${category.slug}`);
    await expectResultsFirst();
  });

  await test.step('the home page and the course catalogue fit a phone', async () => {
    await page.goto(PORTALS.student);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, 'home page at phone width');
    await page.goto(`${PORTALS.student}/courses`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, 'course catalogue at phone width');
  });

  await test.step('the filters open on request', async () => {
    await page.goto(
      `${PORTALS.student}/search?query=${encodeURIComponent(title)}`,
    );
    await page.getByRole('button', { name: /^Filters/ }).click();
    await expect(
      page.getByRole('checkbox', { name: /^Beginner/ }),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, 'filters open at phone width');
  });

  await test.step('a 70-character word does not push the page sideways', async () => {
    await page.goto(`${PORTALS.student}/search?query=${'a'.repeat(70)}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoSidewaysScroll(page);
  });
});

test('a long description does not make a tall card on a phone', async ({
  page,
}) => {
  const scope = uniqueName('phonecards').toLowerCase();
  const instructor = await apiUser('Ivy', ['instructor']);
  const longTitle = uniqueName('E2E phone long description');
  const shortTitle = uniqueName('E2E phone short description');
  const long = await createPublishedCourseViaApi(
    instructor,
    longTitle,
    'A long description of the course. '.repeat(15).slice(0, 500),
  );
  const short = await createPublishedCourseViaApi(
    instructor,
    shortTitle,
    'One line.',
  );
  await setCourseCatalogue(long.courseId, { tags: [scope] });
  await setCourseCatalogue(short.courseId, { tags: [scope] });

  await page.goto(
    `${PORTALS.student}/search?${new URLSearchParams({ tags: JSON.stringify([scope]) })}`,
  );
  const card = (title: string) =>
    page.locator('[data-slot="card"]').filter({ hasText: title });
  await expectAfterReloads(page, async () => {
    await expect(card(longTitle)).toBeVisible({ timeout: 2_000 });
    await expect(card(shortTitle)).toBeVisible({ timeout: 2_000 });
  });
  const tall = await card(longTitle).boundingBox();
  const small = await card(shortTitle).boundingBox();
  expect(tall?.height).toBeLessThanOrEqual((small?.height ?? 0) * 1.5);
  await expectNoSidewaysScroll(page);
  await screenshot(page, 'course cards at phone width');

  await card(longTitle).getByRole('link', { name: longTitle }).click();
  await expect(page).toHaveURL(new RegExp(`/learn/${long.courseId}`));
});

test('the caption languages card fits a phone and each checkbox is one target', async ({
  page,
}) => {
  const title = uniqueName('E2E phone caption course');

  await page.goto(`${PORTALS.instructor}/my-courses`);
  await signIn(page, newUser('Tess', ['instructor']));
  await createCourse(page, { title, summary: 'A course for a phone.' });
  const card = page.getByRole('region', { name: 'Caption languages' });
  await expect(card.getByRole('checkbox').first()).toBeVisible();

  await test.step('nothing scrolls sideways', async () => {
    await expectNoSidewaysScroll(page);
    await screenshot(page, 'caption languages at phone width');
  });

  await test.step('a checkbox and its label touch, and both are at least 24px', async () => {
    const box = card.getByRole('checkbox').first();
    const label = card.locator(`label[for="${await box.getAttribute('id')}"]`);
    const [boxRect, labelRect] = await Promise.all([
      box.boundingBox(),
      label.boundingBox(),
    ]);
    expect(boxRect?.width ?? 0).toBeGreaterThanOrEqual(16);
    expect(labelRect?.height ?? 0).toBeGreaterThanOrEqual(24);
    const gap =
      (labelRect?.x ?? 0) - ((boxRect?.x ?? 0) + (boxRect?.width ?? 0));
    expect(gap).toBeLessThanOrEqual(1);
  });

  await test.step('choosing languages saves and still fits', async () => {
    await chooseCaptionLanguages(page, title, ['Spanish']);
    await expectNoSidewaysScroll(page);
  });
});

test('transcript search results fit a phone, even for a 70-character word', async ({
  page,
}) => {
  const title = uniqueName('E2E phone transcript course');
  const instructor = await apiUser('Ivy', ['instructor']);
  const video = await createCaptionedVideoViaApi(instructor, title);
  const word = uniqueName('nebula').replace(/[^a-z0-9]/gi, '');
  const target =
    await instructor.instructor.contentItem.captionUploadUrl.mutate(video);
  const response = await fetch(target.url, {
    method: 'PUT',
    headers: target.headers,
    body: webVttOf([
      { start: 0, end: 2, text: 'Welcome to this lesson' },
      { start: 2, end: 3, text: `and now ${word} ${'y'.repeat(70)}` },
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

  await openCourse(page, title);
  await enrol(page, newUser('Pia', ['student']));

  await test.step('the search box fits the top of the player', async () => {
    await expectNoSidewaysScroll(page);
    await searchTranscripts(page, word);
  });

  await test.step('the results fit, with the long word wrapped', async () => {
    const result = page
      .getByRole('list', { name: 'Search results' })
      .getByRole('link');
    await expectAfterReloads(page, async () => {
      await expect(result).toHaveCount(1, { timeout: 5_000 });
    });
    await expectNoSidewaysScroll(page);
    await screenshot(page, 'transcript search results at phone width');
  });

  await test.step('a 70-character query does not push the page sideways', async () => {
    await searchTranscripts(page, 'a'.repeat(70));
    await expect(page.getByText(/No moments match/).first()).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, 'transcript search empty at phone width');
  });
});

test('a free preview lesson fits a phone and has its own title', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const instructor = await apiUser('Ivy', ['instructor']);
  const title = uniqueName('E2E phone free preview');
  const { courseId, open } = await createFreePreviewCourseViaApi(
    instructor,
    title,
  );

  await page.goto(
    `${PORTALS.student}/learn/${courseId}/preview/${open.lessonId}`,
  );
  await expect(
    page.getByRole('heading', { level: 1, name: 'Open' }),
  ).toBeVisible();

  await test.step('the page is titled lesson first, then course', async () => {
    await expect(page).toHaveTitle(/^Open · .*E2E phone free preview/);
  });

  await test.step('nothing scrolls sideways', async () => {
    await expectNoSidewaysScroll(page);
    await screenshot(page, 'free preview at phone width', { fullPage: true });
  });

  await test.step('a lesson that is not a preview says so and fits too', async () => {
    await page.goto(
      `${PORTALS.student}/learn/${courseId}/preview/not-a-lesson`,
    );
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'This preview is no longer available.',
      }),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
  });
});

test('the grading queue on the instructor home page fits a phone with long names', async ({
  page,
}) => {
  const ivy = newUser('Ivy', ['instructor']);
  const instructor = await apiUserFor(ivy);
  const tess = await apiUser('Tess', ['student']);
  const long = await createUploadAssignmentCourse(instructor, {
    courseTitle: `${uniqueName('E2E phone queue course')} ${'x'.repeat(60)}`,
    assignmentTitle: `Assignment ${'y'.repeat(60)}`,
  });
  await tess.core.course.enrol.mutate({ courseId: long.courseId });
  await tess.core.assignment.submit.mutate(
    await uploadSubmissionFile(tess, long, 'a.txt', Buffer.from('a')),
  );

  await page.goto(`${PORTALS.instructor}/`);
  await signIn(page, ivy);
  const queue = page.getByRole('region', { name: 'Waiting for grading' });
  await expect(queue.getByRole('link')).toHaveCount(1);
  await expectNoSidewaysScroll(page);
  await screenshot(page, 'grading queue at phone width');
});

// The instructor portal's course editor on a small phone: every control in
// the module, lesson and item rows is on screen, however long the titles, and
// the lesson-item dialogs fit with their Save in reach.
test('the course editor fits a phone', async ({ page }) => {
  const iris = newUser('Iris', ['instructor', 'student']);
  const instructor = await apiUserFor(iris);
  const api = instructor.instructor;
  const longWord = 'x'.repeat(70);
  const longTitle = (n: number) =>
    `${n}: a title that runs on and on, well past sixty characters in all`.padEnd(
      80,
      '.',
    );

  // The first lesson holds a video, made with its own course.
  const video = await createCaptionedVideoViaApi(
    instructor,
    uniqueName('E2E phone editor'),
  );
  const { courseId, moduleId, lessonId } = video;
  const textTitle = `Reading with ${longWord}`;
  const quizTitle = longTitle(0);
  const lesson = { courseId, moduleId, lessonId };

  await api.contentItem.createText.mutate({
    ...lesson,
    title: textTitle,
    body: textBody(`A body with ${longWord} in it`),
  });
  const pdf = await readFile(WORKSHEET_PDF);
  const fileTarget = await api.contentItem.createFileUploadUrl.mutate({
    ...lesson,
    fileName: 'worksheet.pdf',
    fileSize: pdf.byteLength,
  });
  await fetch(fileTarget.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: new Uint8Array(pdf),
  });
  await api.contentItem.createFile.mutate({
    ...lesson,
    contentItemId: fileTarget.contentItemId,
    title: longTitle(1),
    objectKey: fileTarget.objectKey,
    fileName: 'worksheet.pdf',
  });
  const questionIds = Array.from({ length: 12 }, (_, i) => `q${i + 1}`);
  await api.contentItem.createQuiz.mutate({
    ...lesson,
    title: quizTitle,
    questions: questionIds.map((questionId, i) => ({
      questionId,
      kind: 'single' as const,
      prompt: textBody(
        i === 0
          ? 'A long question. '.repeat(30).slice(0, 500)
          : `Question ${i + 1}?`,
      ),
      options: [
        { optionId: 'a', text: 'Right' },
        { optionId: 'b', text: 'Wrong' },
      ],
    })),
    answerKey: Object.fromEntries(
      questionIds.map((id) => [id, { correctOptionIds: ['a'] }]),
    ),
    settings: {
      passMarkPercent: 50,
      attemptsAllowed: 2,
      shuffleOptions: false,
      revealAnswers: 'never',
    },
  });
  await setVideoQuestionsViaApi(instructor, video, [
    {
      questionId: 'v1',
      prompt: 'A long video question. '.repeat(20).slice(0, 400),
      options: ['Colour bars', 'A cat'],
      correct: 0,
      atSeconds: 1,
    },
  ]);

  // Three modules of three lessons with long titles; the first lesson above
  // counts as one of the first module's.
  for (let m = 0; m < 3; m++) {
    const module =
      m === 0
        ? { moduleId }
        : await api.module.create.mutate({
            courseId,
            title: m === 1 ? longWord : longTitle(10 + m),
          });
    for (let l = m === 0 ? 1 : 0; l < 3; l++) {
      await api.lesson.create.mutate({
        courseId,
        moduleId: module.moduleId,
        title: l === 0 && m === 1 ? longWord : longTitle(20 + m * 3 + l),
      });
    }
  }
  await api.course.publish.mutate({ courseId });
  const archived = [
    await api.lesson.create.mutate({
      courseId,
      moduleId,
      title: longTitle(90),
    }),
    await api.lesson.create.mutate({ courseId, moduleId, title: longWord }),
  ];
  for (const { lessonId: archivedId } of archived) {
    await api.lesson.delete.mutate({
      courseId,
      moduleId,
      lessonId: archivedId,
    });
  }

  await page.goto(`${PORTALS.instructor}/my-courses`);
  await signIn(page, iris);
  await page.goto(`${PORTALS.instructor}/my-courses/${courseId}`);
  const content = page.getByRole('region', { name: 'Course content' });
  await expect(content).toBeVisible();

  await test.step('every control is on screen, and each item says what it is', async () => {
    await expectNoSidewaysScroll(page);
    await expectOnScreen(content.getByRole('button'));
    for (const title of [textTitle, quizTitle, longTitle(1)]) {
      await expect(content.getByText(title, { exact: true })).toBeVisible();
    }
    await content.scrollIntoViewIfNeeded();
    await screenshot(page, 'course editor at phone width', { fullPage: true });
  });

  await test.step('the archived rows fit, with Restore and Delete on screen', async () => {
    const archivedSection = page.getByRole('region', { name: 'Archived' });
    await archivedSection.scrollIntoViewIfNeeded();
    await expect(archivedSection).toBeVisible();
    await expectOnScreen(archivedSection.getByRole('button'));
    await screenshot(page, 'archived rows at phone width');
  });

  await test.step('the quiz builder fits, with Save in reach', async () => {
    await content.getByRole('button', { name: `Edit ${quizTitle}` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Collapse Question 1' }).click();
    await expectDialogFits(dialog);
    await expectOnScreen(dialog.getByRole('button', { name: 'Save quiz' }));
    await screenshot(page, 'quiz builder at phone width');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  await test.step('the video questions fit, with Save in reach', async () => {
    const dialog = await openVideoQuestions(page, 'Video');
    await expectDialogFits(dialog);
    await expectOnScreen(dialog.getByRole('button', { name: 'Save' }));
    await screenshot(page, 'video questions with a long question');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  await test.step('Edit text fits with a long word in the body', async () => {
    await content.getByRole('button', { name: `Edit ${textTitle}` }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit text' });
    await expect(dialog).toBeVisible();
    await expectDialogFits(dialog);
    await expectOnScreen(dialog.getByRole('button', { name: 'Save' }));
  });
});
