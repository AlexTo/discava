/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, type Page } from '@playwright/test';
import type { ApiUser } from './api.js';
import { SERVICES } from './portals.js';
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

type AssignmentRef = Awaited<ReturnType<typeof createUploadAssignmentCourse>>;

// Uploads `body` as a new submission file, as the portal does: a presigned
// PUT to the upload bucket. Returns what `assignment.submit` is given.
export const uploadSubmissionFile = async (
  student: ApiUser,
  ref: AssignmentRef,
  fileName: string,
  body: Buffer,
) => {
  const target = await student.core.assignment.uploadUrl.mutate({
    ...ref,
    fileName,
    fileSize: body.length,
  });
  const response = await fetch(target.uploadUrl, {
    method: 'PUT',
    headers: target.headers,
    body: new Uint8Array(body),
  });
  if (!response.ok) {
    throw new Error(`Uploading ${fileName} failed: ${response.status}`);
  }
  return { ...ref, objectKey: target.objectKey, fileName };
};

// The local lesson media bucket (see LOCAL_S3 in common-server-utils).
export const LESSON_MEDIA_BUCKET = 'discava-lesson-media';

// The folders holding submission files of the assignment, in the media bucket
// (S3Mock lists anonymously over plain HTTP).
export const submissionFolders = async (ref: AssignmentRef) => {
  const prefix = `courses/${ref.courseId}/modules/${ref.moduleId}/lessons/${ref.lessonId}/content-items/${ref.contentItemId}/submissions/`;
  const response = await fetch(
    `${SERVICES.s3Mock}${LESSON_MEDIA_BUCKET}?list-type=2&prefix=${encodeURIComponent(prefix)}`,
  );
  const xml = await response.text();
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
  return new Set(keys.map((key) => key.slice(0, key.lastIndexOf('/'))));
};
