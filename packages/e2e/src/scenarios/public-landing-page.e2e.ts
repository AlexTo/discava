/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AppRouter as CoreApi } from '@discava/core-api';
import { createTRPCClient, httpLink } from '@trpc/client';
import {
  apiClients,
  apiUser,
  createPublishedCourseViaApi,
} from '../helpers/api.js';
import { COURSE_IMAGE_BARS } from '../helpers/images.js';
import {
  addLesson,
  addModule,
  addTextItem,
  createCourse,
  publishCourse,
} from '../helpers/instructor-portal.js';
import { PORTALS, SERVICES } from '../helpers/portals.js';
import { coursePageUrl } from '../helpers/public-pages.js';
import { screenshot } from '../helpers/screenshots.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';
import { expectToPlay, THREE_SECOND_VIDEO } from '../helpers/video.js';

// The instructor writes the landing page in the portal; the public page then
// shows what a visitor needs to decide: outcomes, requirements and who teaches.
test('an instructor edits the landing page and a signed-out visitor sees it', async ({
  browser,
}) => {
  const title = uniqueName('E2E landing course');
  const instructor = await browser.newPage();
  const visitor = await browser.newPage();

  await test.step('the instructor publishes a course', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Ivy', ['instructor']));
    await createCourse(instructor, {
      title,
      summary: 'A course for the landing page tests.',
    });
    await addModule(instructor, 'Module one');
    await addLesson(instructor, 'Lesson one');
    await addTextItem(instructor, { title: 'Reading one', body: 'Hello.' });
    await publishCourse(instructor);
  });

  await test.step('the card saves outcomes and requirements, and the checklist follows', async () => {
    const checklist = instructor.getByRole('region', {
      name: 'Landing page checklist',
    });
    await expect(
      checklist.getByRole('listitem').filter({ hasText: 'Learning outcomes' }),
    ).toContainText('Not yet');

    const outcomes = 'What students will learn';
    await instructor
      .getByRole('button', { name: `Add ${outcomes} item` })
      .click();
    await instructor
      .getByLabel(`${outcomes} item 1`, { exact: true })
      .fill('Build a landing page');
    await instructor
      .getByRole('button', { name: `Add ${outcomes} item` })
      .click();
    await instructor
      .getByLabel(`${outcomes} item 2`, { exact: true })
      .fill('Read a curriculum');
    await instructor
      .getByRole('button', { name: 'Move up What students will learn item 2' })
      .click();
    await instructor
      .getByRole('button', { name: 'Add Requirements item' })
      .click();
    await instructor
      .getByLabel('Requirements item 1', { exact: true })
      .fill('A laptop');
    await instructor.getByRole('button', { name: 'Save landing page' }).click();
    await expect(instructor.getByText('Saved', { exact: true })).toBeVisible();

    await expect(
      checklist.getByRole('listitem').filter({ hasText: 'Learning outcomes' }),
    ).toContainText('Done');
    await expect(
      instructor.getByRole('link', { name: 'View public page' }),
    ).toBeVisible();
    await screenshot(instructor, 'landing page card and checklist', {
      fullPage: true,
    });
  });

  await test.step('signed out, the sections show in the order the instructor set', async () => {
    const courseId = instructor.url().split('/').pop() as string;
    await visitor.goto(coursePageUrl(courseId));
    await expect(
      visitor.getByRole('heading', { level: 1, name: title }),
    ).toBeVisible();
    const learn = visitor.getByRole('region', { name: "What you'll learn" });
    await expect(learn.getByRole('listitem')).toHaveText([
      'Read a curriculum',
      'Build a landing page',
    ]);
    await expect(
      visitor
        .getByRole('region', { name: 'Requirements' })
        .getByText('A laptop'),
    ).toBeVisible();
    await expect(
      visitor
        .getByRole('region', { name: 'Instructors' })
        .getByText('View profile'),
    ).toBeVisible();
    await screenshot(visitor, 'landing page with outcomes and instructor', {
      fullPage: true,
    });
  });
});

// A course that is archived is not found for anyone, including a student who
// enrolled.
test('an archived course is not found for a visitor or an enrolled student', async ({
  page,
}) => {
  const instructor = await apiUser('Ivy', ['instructor']);
  const { courseId } = await createPublishedCourseViaApi(
    instructor,
    uniqueName('E2E archived landing course'),
  );
  const student = await apiUser('Sam', ['student']);
  await student.core.course.enrol.mutate({ courseId });
  await instructor.instructor.course.archive.mutate({ courseId });

  await page.goto(coursePageUrl(courseId));
  await expect(
    page.getByRole('heading', { name: 'Course not found' }),
  ).toBeVisible();
  await screenshot(page, 'archived course not found');

  // An enrolled student gets the same answer from the API.
  await expect(
    student.core.course.publicView.query({ courseId }),
  ).rejects.toMatchObject({ data: { code: 'NOT_FOUND' } });
});

// The instructor uploads a preview in the landing page card (the event runner
// transcodes it with ffmpeg, standing in for MediaConvert, #137); a signed-out
// visitor plays it, but no lesson video; an over-long replacement is refused
// with the current preview still playing; removing it brings the image back.
test('an instructor uploads a preview and a signed-out visitor watches it', async ({
  browser,
}) => {
  const title = uniqueName('E2E preview course');
  const instructor = await browser.newPage();
  const visitor = await browser.newPage();
  const signedOut = createTRPCClient<CoreApi>({
    links: [httpLink({ url: SERVICES.coreApi })],
  });
  const previewArea = instructor.locator(
    'section[aria-labelledby="preview-video-heading"]',
  );
  let courseId = '';

  await test.step('the instructor publishes a course and uploads a preview', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Ivy', ['instructor']));
    await createCourse(instructor, {
      title,
      summary: 'A course for the preview tests.',
    });
    courseId = instructor.url().split('/').pop() as string;
    await addModule(instructor, 'Module one');
    await addLesson(instructor, 'Lesson one');
    await addTextItem(instructor, { title: 'Reading one', body: 'Hello.' });
    await publishCourse(instructor);

    await previewArea
      .getByLabel('Preview video file')
      .setInputFiles(THREE_SECOND_VIDEO);
    await expect(previewArea.getByText(/Processing video/)).toBeVisible();
    await screenshot(instructor, 'preview video processing', {
      fullPage: true,
    });
    // Ready once the local transcode has run: the player appears.
    await expect(previewArea.locator('video')).toBeAttached({
      timeout: 90_000,
    });
    await expect(
      instructor
        .getByRole('region', { name: 'Landing page checklist' })
        .getByRole('listitem')
        .filter({ hasText: 'Preview video' }),
    ).toContainText('Done');
    await screenshot(instructor, 'preview video ready in the card', {
      fullPage: true,
    });
  });

  await test.step('signed out, the visitor presses play and the preview plays', async () => {
    await visitor.goto(coursePageUrl(courseId));
    await expect(
      visitor.getByRole('heading', { level: 1, name: title }),
    ).toBeVisible();
    await expect(visitor.getByText(/Preview this course/)).toBeVisible();
    await visitor.getByRole('button', { name: 'Play preview' }).click();
    const video = visitor.locator('video[data-slot="hls-video"]');
    await expectToPlay(video);
    await screenshot(visitor, 'preview playing on the public page');
  });

  await test.step('signed out, a lesson video is still refused', async () => {
    await expect(
      signedOut.contentItem.videoUrl.query({
        courseId,
        moduleId: 'module',
        lessonId: 'lesson',
        contentItemId: 'item',
      }),
    ).rejects.toMatchObject({ data: { code: 'UNAUTHORIZED' } });
  });

  await test.step('an over-long replacement is refused and the preview keeps playing', async () => {
    // The card refuses a long file before uploading it (its component tests
    // cover that); here the API is asked directly as the signed-in instructor,
    // since a file over 5 minutes is too slow to make in CI.
    const token = await instructor.evaluate(() => {
      for (const storage of [sessionStorage, localStorage]) {
        for (let i = 0; i < storage.length; i++) {
          const value = storage.getItem(storage.key(i) ?? '') ?? '';
          const found = value.match(/"access_token"\s*:\s*"([^"]+)"/)?.[1];
          if (found) {
            return found;
          }
        }
      }
      return undefined;
    });
    expect(token).toBeDefined();
    const api = apiClients(token as string).instructor;
    const { preview } = await api.course.view.query({ courseId });
    await expect(
      api.coursePreview.replace.mutate({
        courseId,
        rawKey: `courses/${courseId}/preview/uploads/none.mp4`,
        durationSeconds: 301,
        expectedSubmissionNonce: preview?.submissionNonce ?? '',
      }),
    ).rejects.toMatchObject({
      message: 'A preview can be at most 5 minutes long',
    });
    await expect(previewArea.locator('video')).toBeAttached();
    await screenshot(instructor, 'over-long preview refused', {
      fullPage: true,
    });
    await expect(
      signedOut.course.previewVideoUrl.query({ courseId }),
    ).resolves.toMatchObject({ url: expect.any(String) });
  });

  await test.step('removing the preview brings the course image back', async () => {
    await previewArea.getByRole('button', { name: 'Remove' }).click();
    await instructor
      .getByRole('alertdialog', { name: 'Remove the preview video' })
      .getByRole('button', { name: 'Remove video' })
      .click();
    await expect(
      previewArea.getByText('Drop a video or click to browse'),
    ).toBeVisible();

    await visitor.reload();
    await expect(
      visitor.getByRole('heading', { level: 1, name: title }),
    ).toBeVisible();
    await expect(
      visitor.getByRole('button', { name: 'Play preview' }),
    ).toHaveCount(0);
    await expect(
      signedOut.course.previewVideoUrl.query({ courseId }),
    ).rejects.toMatchObject({ data: { code: 'NOT_FOUND' } });
    await screenshot(visitor, 'public page after the preview is removed');
  });
});

// The instructor fills in their public profile and photo; a signed-out visitor
// reaches it from the course's instructor card and sees only published courses.
test('an instructor edits their profile and a signed-out visitor opens it from the course', async ({
  browser,
}) => {
  const title = uniqueName('E2E profile course');
  const displayName = uniqueName('Ivy Profile');
  const handle = `ivy-${Date.now().toString(36)}`;
  const instructor = await browser.newPage();
  const visitor = await browser.newPage();
  let courseUrl = '';

  await test.step('the instructor publishes a course', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Ivy', ['instructor']));
    await createCourse(instructor, {
      title,
      summary: 'A course for the profile tests.',
    });
    await addModule(instructor, 'Module one');
    await addLesson(instructor, 'Lesson one');
    await addTextItem(instructor, { title: 'Reading one', body: 'Hello.' });
    await publishCourse(instructor);
    courseUrl = instructor.url();
    await expect(
      instructor
        .getByRole('region', { name: 'Landing page checklist' })
        .getByRole('listitem')
        .filter({ hasText: 'Your profile' }),
    ).toContainText('Not yet');
  });

  await test.step('the instructor fills in the profile and uploads a photo', async () => {
    await instructor.getByRole('button', { name: 'Open user menu' }).click();
    await instructor.getByRole('menuitem', { name: 'Public profile' }).click();
    await expect(
      instructor.getByRole('heading', { name: 'Public profile' }),
    ).toBeVisible();

    await instructor.getByLabel('Display name').fill(displayName);
    await instructor.getByLabel('Handle').fill(handle);
    await expect(
      instructor.getByText(`Your address: /instructors/${handle}`),
    ).toBeVisible();
    await instructor.getByLabel('Headline').fill('Teaches by example');
    await instructor
      .getByLabel('Bio')
      .fill('First paragraph of the bio.\n\nSecond paragraph of the bio.');
    await instructor.getByRole('button', { name: 'Save' }).click();
    await expect(instructor.getByText('Profile saved.')).toBeVisible();

    await instructor.getByRole('button', { name: 'Add photo' }).click();
    const dialog = instructor.getByRole('dialog', { name: 'Profile photo' });
    await dialog
      .getByLabel('Profile photo file')
      .setInputFiles(COURSE_IMAGE_BARS);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(
      instructor.getByRole('button', { name: 'Change photo' }),
    ).toBeVisible();
    await expect(instructor.getByTestId('profile-status')).toContainText(
      'Your profile is public',
    );
    await screenshot(instructor, 'profile editor', { fullPage: true });
  });

  await test.step('the checklist counts the profile as done', async () => {
    await instructor.goto(courseUrl);
    await expect(
      instructor
        .getByRole('region', { name: 'Landing page checklist' })
        .getByRole('listitem')
        .filter({ hasText: 'Your profile' }),
    ).toContainText('Done');
  });

  await test.step('signed out, the visitor opens the profile from the course', async () => {
    const courseId = courseUrl.split('/').pop() as string;
    await visitor.goto(coursePageUrl(courseId));
    await visitor
      .getByRole('region', { name: 'Instructors' })
      .getByRole('link', { name: 'View profile' })
      .click();

    await expect(
      visitor.getByRole('heading', { level: 1, name: displayName }),
    ).toBeVisible();
    await expect(visitor).toHaveURL(new RegExp(`/instructors/${handle}$`));
    await expect(visitor.getByText('Teaches by example')).toBeVisible();
    await expect(
      visitor.getByText('Second paragraph of the bio.'),
    ).toBeVisible();
    await expect(
      visitor
        .getByRole('region', { name: `Courses by ${displayName}` })
        .getByText(title),
    ).toBeVisible();
    await screenshot(visitor, 'public instructor profile', { fullPage: true });
  });
});
