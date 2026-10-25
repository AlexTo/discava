/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, test } from '@playwright/test';
import {
  COURSE_IMAGE_BARS,
  COURSE_IMAGE_PATTERN,
  expectImageLoaded,
  publicMediaImages,
} from '../helpers/images.js';
import {
  addLesson,
  addModule,
  addTextItem,
  courseImagePreview,
  createCourse,
  publishCourse,
  removeCourseImage,
  setCourseImage,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import { expectAfterReloads, openCourse } from '../helpers/student-portal.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';

// A course's display image (#76): cropped in the browser to a 1280x720 JPEG,
// uploaded straight to the public media bucket (S3Mock locally), and shown to
// anyone on the course's page, signed in or not.
test('an instructor adds, replaces and removes a course image', async ({
  browser,
}) => {
  const course = uniqueName('E2E image course');
  const instructor = await browser.newPage();
  const visitor = await browser.newPage();
  let firstImage: string | null = null;

  await test.step('the instructor adds an image and publishes', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Ivy', ['instructor']));
    await createCourse(instructor, {
      title: course,
      summary: 'A course with an image, made by the end-to-end tests.',
    });
    await setCourseImage(instructor, COURSE_IMAGE_BARS);
    await expectImageLoaded(courseImagePreview(instructor), 1280);
    await addModule(instructor, 'Module one');
    await addLesson(instructor, 'Lesson one');
    await addTextItem(instructor, { title: 'Reading one', body: 'Hello.' });
    await publishCourse(instructor);
  });

  await test.step('a visitor sees it on the course page', async () => {
    await openCourse(visitor, course);
    const image = publicMediaImages(visitor).first();
    await expectImageLoaded(image, 1280);
    firstImage = await image.getAttribute('src');
  });

  await test.step('replacing it shows the new one', async () => {
    await setCourseImage(instructor, COURSE_IMAGE_PATTERN);

    await expectAfterReloads(visitor, async () => {
      await expect(publicMediaImages(visitor).first()).not.toHaveAttribute(
        'src',
        firstImage ?? '',
        { timeout: 2_000 },
      );
    });
    await expectImageLoaded(publicMediaImages(visitor).first(), 1280);
  });

  await test.step('removing it leaves the course without one', async () => {
    await removeCourseImage(instructor);

    await expectAfterReloads(visitor, async () => {
      await expect(
        visitor.getByRole('heading', { level: 1, name: course }),
      ).toBeVisible({ timeout: 2_000 });
      await expect(publicMediaImages(visitor)).toHaveCount(0);
    });
  });
});
