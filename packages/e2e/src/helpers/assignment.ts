/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, type Page } from '@playwright/test';
import type { ApiUser } from './api.js';
import { lessonItem } from './student-portal.js';

// Steps for upload assignments (#102), for scenarios to build on.

const instructions = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

// A published course with one module and one upload assignment, built through
// instructor-api (the instructor portal has no screen for it yet). The
// assignment's lesson takes its title.
export const createUploadAssignmentCourse = async (
  instructor: ApiUser,
  {
    courseTitle,
    assignmentTitle,
    dueAt,
  }: { courseTitle: string; assignmentTitle: string; dueAt?: string },
) => {
  const api = instructor.instructor;
  const { courseId } = await api.course.create.mutate({ title: courseTitle });
  const { moduleId } = await api.module.create.mutate({
    courseId,
    title: 'Module 1',
  });
  const lesson = await api.lesson.createUploadAssignment.mutate({
    courseId,
    moduleId,
    title: assignmentTitle,
    body: instructions('Write about the lesson.'),
    maxPoints: 10,
    ...(dueAt && { dueAt }),
  });
  await api.course.publish.mutate({ courseId });
  const [item] = (await api.course.view.query({ courseId })).modules[0]
    .lessons[0].contentItems;
  return {
    courseId,
    moduleId,
    lessonId: lesson.lessonId,
    contentItemId: item.contentItemId,
  };
};

// The open lesson's upload assignment, found by its title.
export const assignmentItem = (page: Page, title: string) =>
  lessonItem(page, title);

// Chooses `file` (a path, or an in-memory file) in the assignment's picker.
export const chooseSubmissionFile = (
  page: Page,
  title: string,
  file: string | { name: string; mimeType: string; buffer: Buffer },
) => assignmentItem(page, title).getByLabel('Choose file').setInputFiles(file);

// Submits the chosen file and waits for the confirmation. Returns the item,
// which then shows the submission.
export const submitChosenFile = async (page: Page, title: string) => {
  const item = assignmentItem(page, title);
  await item.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(item.getByText(/^Submitted/)).toBeVisible({ timeout: 30_000 });
  return item;
};
