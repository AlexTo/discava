/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type ApiUser, anonymousCoreClient, apiUser } from '../helpers/api.js';
import {
  createFreePreviewCourseViaApi,
  lessonRow,
  markFreePreview,
  removeFreePreview,
} from '../helpers/free-preview.js';
import {
  addLesson,
  addModule,
  addUploadAssignment,
  createCourse,
  publishCourse,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { screenshot } from '../helpers/screenshots.js';
import { lessonVideo } from '../helpers/student-portal.js';
import { expect, test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// What a refused call fails with: its tRPC error code.
const expectCode = async (call: Promise<unknown>, code: string) => {
  const error = await call.then(
    () => undefined,
    (failure: unknown) => failure,
  );
  expect((error as { data?: { code?: string } } | undefined)?.data?.code).toBe(
    code,
  );
};

const previewUrl = (courseId: string, lessonId: string) =>
  `${PORTALS.student}/learn/${courseId}/preview/${lessonId}`;

// Free preview lessons: an instructor marks an ordinary lesson in the course
// editor. The mark is independent of whether the course is published; the
// badge says whether anyone can open the lesson yet.
test.describe('an instructor marks a lesson as a free preview', () => {
  test('marks and unmarks an ordinary lesson, and an assignment has no control', async ({
    page,
  }) => {
    const course = uniqueName('E2E free preview course');

    await page.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(page, newUser('Ivy', ['instructor']));
    await createCourse(page, {
      title: course,
      summary: 'A course whose first lesson is a free preview.',
    });
    await addModule(page, 'Module one');
    await addLesson(page, 'Welcome');
    await addUploadAssignment(page, {
      title: 'Essay',
      instructions: 'Write about the lesson.',
      maxPoints: 10,
    });

    await test.step('the lesson is marked after a confirmation', async () => {
      await markFreePreview(page, 'Welcome', {
        beforeConfirm: () => screenshot(page, 'confirm-free-preview'),
      });
      await expect(
        lessonRow(page, 'Welcome').getByText('Free preview (not public yet)'),
      ).toBeVisible();
      await screenshot(page, 'badge-draft-course');
    });

    await test.step('an assignment lesson has no control', async () => {
      await expect(
        lessonRow(page, 'Essay').getByRole('button', {
          name: /free preview/i,
        }),
      ).toHaveCount(0);
    });

    await test.step('publishing the course makes the badge plain', async () => {
      await publishCourse(page);
      await expect(
        lessonRow(page, 'Welcome').getByText('Free preview', { exact: true }),
      ).toBeVisible();
      await screenshot(page, 'badge-published-course');
    });

    await test.step('the mark is removed at once', async () => {
      await removeFreePreview(page, 'Welcome');
      await expect(
        lessonRow(page, 'Welcome').getByText(/^Free preview/),
      ).toHaveCount(0);
    });
  });
});

// A visitor opens a free preview without enrolling: the landing page labels
// the lesson, its text, video and file work, its quiz stays locked, and
// nothing outside the lesson is reachable.
test.describe('a visitor watches a free preview', () => {
  test('opens it signed out, and is refused everything else', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const instructor = await apiUser('Ivy', ['instructor']);
    const course = uniqueName('E2E free preview visitor');
    const { courseId, moduleId, open, locked } =
      await createFreePreviewCourseViaApi(instructor, course);
    const visitor = await browser.newPage();
    const api = anonymousCoreClient();
    const openLesson = { courseId, moduleId, lessonId: open.lessonId };
    const lockedLesson = { courseId, moduleId, lessonId: locked.lessonId };

    await test.step('the landing page labels only the marked lesson', async () => {
      await visitor.goto(`${PORTALS.student}/learn/${courseId}`);
      await expect(
        visitor.getByRole('link', { name: 'Open', exact: true }),
      ).toBeVisible();
      await expect(visitor.getByText('Free preview')).toHaveCount(1);
      await expect(
        visitor.getByRole('link', { name: 'Locked', exact: true }),
      ).toHaveCount(0);
      await screenshot(visitor, 'outline-free-preview-label');
    });

    await test.step('the preview shows its text, file and locked quiz', async () => {
      await visitor.getByRole('link', { name: 'Open', exact: true }).click();
      await visitor.waitForURL(previewUrl(courseId, open.lessonId));
      await expect(
        visitor.getByRole('heading', { level: 1, name: 'Open' }),
      ).toBeVisible();
      await expect(visitor.getByText('Open text body')).toBeVisible();
      await expect(visitor.getByText('Open hidden reading')).toHaveCount(0);
      await expect(visitor.getByText('worksheet.pdf')).toBeVisible();
      await expect(visitor.getByText('1 question')).toBeVisible();
      await expect(visitor.getByText('Enrol to take this quiz')).toBeVisible();
      await expect(
        visitor.getByRole('button', { name: /Start quiz|Mark as done/ }),
      ).toHaveCount(0);
      await screenshot(visitor, 'preview-page', { fullPage: true });
    });

    await test.step('Play starts the video', async () => {
      await visitor.getByRole('button', { name: 'Play' }).click();
      await expect(lessonVideo(visitor, 'Open video')).toBeAttached();
      await screenshot(visitor, 'preview-video-playing');
    });

    await test.step('Download saves the file', async () => {
      const downloading = visitor.waitForEvent('download');
      await visitor.getByRole('button', { name: 'Download' }).click();
      expect((await downloading).suggestedFilename()).toBe('worksheet.pdf');
    });

    await test.step('another lesson of the course is refused with no token', async () => {
      await expectCode(api.freePreview.lesson.query(lockedLesson), 'NOT_FOUND');
      await expectCode(
        api.freePreview.videoUrl.query({
          ...lockedLesson,
          contentItemId: locked.video.contentItemId,
        }),
        'NOT_FOUND',
      );
      await expectCode(
        api.freePreview.fileUrl.query({
          ...lockedLesson,
          contentItemId: locked.file.contentItemId,
        }),
        'NOT_FOUND',
      );
      // The marked lesson's address with the other lesson's items.
      await expectCode(
        api.freePreview.videoUrl.query({
          ...openLesson,
          contentItemId: locked.video.contentItemId,
        }),
        'NOT_FOUND',
      );
      await expectCode(
        api.freePreview.fileUrl.query({
          ...openLesson,
          contentItemId: locked.file.contentItemId,
        }),
        'NOT_FOUND',
      );
      await expectCode(
        api.contentItem.videoUrl.query(open.video),
        'UNAUTHORIZED',
      );
    });

    await test.step('a hidden item is not shown and not signed', async () => {
      await expectCode(
        api.freePreview.videoUrl.query({
          ...openLesson,
          contentItemId: open.hidden.contentItemId,
        }),
        'NOT_FOUND',
      );
    });

    await test.step('a signed-in student who is not enrolled sees the same page, and no more', async () => {
      const student = await apiUser('Sam', ['student']);
      await visitor.goto(`${PORTALS.student}/my-learning`);
      await signIn(visitor, newUser('Sam', ['student']));
      await visitor.goto(previewUrl(courseId, open.lessonId));
      await expect(
        visitor.getByRole('heading', { level: 1, name: 'Open' }),
      ).toBeVisible();
      await expect(visitor.getByText('Open text body')).toBeVisible();
      await expectCode(
        student.core.contentItem.videoUrl.query(open.video),
        'FORBIDDEN',
      );
      await expectCode(
        student.core.contentItem.fileUrl.query(open.file),
        'FORBIDDEN',
      );
      await expectCode(
        student.core.course.view.query({ courseId }),
        'FORBIDDEN',
      );
    });

    await test.step('unmarking the lesson closes it', async () => {
      await instructor.instructor.lesson.setFreePreview.mutate({
        ...openLesson,
        freePreview: false,
      });
      await expectCode(api.freePreview.lesson.query(openLesson), 'NOT_FOUND');
      await visitor.goto(previewUrl(courseId, open.lessonId));
      await expect(
        visitor.getByText('This preview is no longer available.'),
      ).toBeVisible();
      await screenshot(visitor, 'preview-no-longer-available');
    });

    await test.step('hiding the lesson, or archiving the course, closes it too', async () => {
      await closesWhen(instructor, api, openLesson, async () => {
        await instructor.instructor.lesson.hide.mutate(openLesson);
      });
      await instructor.instructor.lesson.publish.mutate(openLesson);
      await instructor.instructor.lesson.setFreePreview.mutate({
        ...openLesson,
        freePreview: true,
      });
      await closesWhen(instructor, api, openLesson, async () => {
        await instructor.instructor.course.archive.mutate({ courseId });
      });
    });
  });
});

// Checks the preview is open, runs `close`, and checks it is closed.
const closesWhen = async (
  instructor: ApiUser,
  api: ReturnType<typeof anonymousCoreClient>,
  lesson: { courseId: string; moduleId: string; lessonId: string },
  close: () => Promise<void>,
) => {
  await instructor.instructor.lesson.setFreePreview.mutate({
    ...lesson,
    freePreview: true,
  });
  await expect(
    api.freePreview.lesson.query(lesson).then(() => 'open'),
  ).resolves.toBe('open');
  await close();
  await expectCode(api.freePreview.lesson.query(lesson), 'NOT_FOUND');
};
