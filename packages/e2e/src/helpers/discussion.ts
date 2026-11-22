/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { type ApiUser, apiUser, createPublishedCourseViaApi } from './api.js';

// A UUID v7 minted now, the id the discussion API wants for a new post: its
// first 48 bits are the milliseconds, which the API checks are recent.
export const newPostId = (now = Date.now()): string => {
  const bytes = randomBytes(10);
  bytes[0] = (bytes[0] & 0x0f) | 0x70;
  bytes[2] = (bytes[2] & 0x3f) | 0x80;
  const time = now.toString(16).padStart(12, '0').slice(-12);
  const random = bytes.toString('hex');
  return `${time.slice(0, 8)}-${time.slice(8)}-${random.slice(0, 4)}-${random.slice(4, 8)}-${random.slice(8)}`;
};

// Steps for lesson discussions (#280), for the scenarios and the concurrency
// test. They call the APIs, as a portal would, for the setup a page needn't
// show.

export interface LessonKey {
  courseId: string;
  moduleId: string;
  lessonId: string;
}

// A published course with one visible lesson, made by a new instructor.
export const createDiscussionCourse = async (title: string) => {
  const instructor = await apiUser('Ivy', ['instructor']);
  const lesson = await createPublishedCourseViaApi(instructor, title);
  const key: LessonKey = {
    courseId: lesson.courseId,
    moduleId: lesson.moduleId,
    lessonId: lesson.lessonId,
  };
  return { instructor, key };
};

// A published course with two visible lessons (each with a text item), made
// by a new instructor.
export const createTwoLessonCourse = async (title: string) => {
  const instructor = await apiUser('Ivy', ['instructor']);
  const api = instructor.instructor;
  const { courseId } = await api.course.create.mutate({ title });
  const { moduleId } = await api.module.create.mutate({
    courseId,
    title: 'Module 1',
  });
  const lessonIds: string[] = [];
  for (const lessonTitle of ['Lesson 1', 'Lesson 2']) {
    const { lessonId } = await api.lesson.create.mutate({
      courseId,
      moduleId,
      title: lessonTitle,
    });
    await api.contentItem.createText.mutate({
      courseId,
      moduleId,
      lessonId,
      title: `Reading for ${lessonTitle}`,
      body: JSON.stringify({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: lessonTitle }] },
        ],
      }),
    });
    lessonIds.push(lessonId);
  }
  await api.course.publish.mutate({ courseId });
  return { instructor, courseId, moduleId, lessonIds };
};

// Answers the first-lesson prompt shown in the open lesson.
export const answerFirstLessonPrompt = async (page: Page, text: string) => {
  await page.getByLabel('Your answer').fill(text);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
};

// A new student enrolled in the course.
export const enrolledStudent = async (givenName: string, courseId: string) => {
  const student = await apiUser(givenName, ['student']);
  await student.core.course.enrol.mutate({ courseId });
  return student;
};

export const ask = (
  user: ApiUser,
  key: LessonKey,
  title: string,
  body = 'Some details.',
) =>
  user.core.discussion.ask.mutate({ ...key, postId: newPostId(), title, body });

export const reply = (
  user: ApiUser,
  key: LessonKey,
  threadId: string,
  body: string,
) =>
  user.core.discussion.reply.mutate({
    ...key,
    threadId,
    postId: newPostId(),
    body,
  });

// The thread as `user` reads it.
export const readThread = async (
  user: ApiUser,
  key: LessonKey,
  threadId: string,
) => {
  const { question, accepted, replies } =
    await user.core.discussion.thread.query({ ...key, threadId });
  return { question, accepted, replies };
};

export { dropEnrolment } from './announcement.js';
