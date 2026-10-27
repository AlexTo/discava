/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  addLesson,
  addModule,
  addVideoItem,
  createCourse,
  expectVideoPreviewToPlay,
  publishCourse,
} from '../helpers/instructor-portal.js';
import { PORTALS } from '../helpers/portals.js';
import {
  enrol,
  expectCourseCompleted,
  lessonVideo,
  markItemDone,
  openCourse,
  startFirstLesson,
} from '../helpers/student-portal.js';
import { test } from '../helpers/table-invariants.js';
import { newUser, signIn, uniqueName } from '../helpers/users.js';
import { expectToPlay, THREE_SECOND_VIDEO } from '../helpers/video.js';

// A lesson video from upload to playback: the upload goes to S3Mock, the event
// runner transcodes it to HLS with ffmpeg (standing in for MediaConvert, #137)
// and marks it ready, and both portals play it through their APIs' signed
// URLs.
test('an instructor uploads a video, and a student watches it', async ({
  browser,
}) => {
  const course = uniqueName('E2E video course');
  const instructor = await browser.newPage();
  const student = await browser.newPage();

  await test.step('the instructor uploads a video and previews it', async () => {
    await instructor.goto(`${PORTALS.instructor}/my-courses`);
    await signIn(instructor, newUser('Ivy', ['instructor']));
    await createCourse(instructor, {
      title: course,
      summary: 'A video course made by the end-to-end tests.',
    });
    await addModule(instructor, 'Module one');
    await addLesson(instructor, 'Lesson one');
    await addVideoItem(instructor, {
      title: 'Video one',
      file: THREE_SECOND_VIDEO,
    });
    await expectVideoPreviewToPlay(instructor, 'Video one');
    await publishCourse(instructor);
  });

  await test.step('a new student enrols and watches it', async () => {
    await openCourse(student, course);
    await enrol(student, newUser('Sam', ['student']));
    await startFirstLesson(student);
    await expectToPlay(lessonVideo(student, 'Video one'));
    await markItemDone(student, 'Video one');
  });

  await test.step('the course shows as completed', async () => {
    await student.getByRole('link', { name: course }).click();
    await expectCourseCompleted(student);
  });
});
