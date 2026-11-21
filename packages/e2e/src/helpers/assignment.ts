/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, type Page } from '@playwright/test';
import { type ApiUser, accessTokenForClaims, apiClients } from './api.js';
import { localSubFor } from './notification.js';
import { PORTALS, SERVICES } from './portals.js';
import { lessonItem } from './student-portal.js';
import type { NewUser } from './users.js';

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
    maxPoints = 10,
  }: {
    courseTitle: string;
    assignmentTitle: string;
    dueAt?: string;
    maxPoints?: number;
  },
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
    maxPoints,
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

// The API clients of a user who also signs in through the browser: the local
// OIDC page derives their sub from the username (`localSubFor`), so what they
// create over the API is theirs in the portal.
export const apiUserFor = async (user: NewUser): Promise<ApiUser> =>
  apiClients(
    await accessTokenForClaims(user.username, {
      sub: localSubFor(user.username),
      username: user.username,
      email: user.email,
      email_verified: true,
      given_name: user.givenName,
      family_name: user.familyName,
      name: `${user.givenName} ${user.familyName}`,
      'cognito:groups': user.roles,
    }),
  );

// Opens the assignment's lesson in the student portal.
export const openLesson = (page: Page, ref: AssignmentRef) =>
  page.goto(`${PORTALS.student}/learn/${ref.courseId}/lesson/${ref.lessonId}`);

// Grading steps in the instructor portal.

// Opens the assignment's submissions list from the course editor's
// "Submissions" link.
export const openSubmissions = async (
  page: Page,
  ref: AssignmentRef,
  assignmentTitle: string,
) => {
  await page.goto(`${PORTALS.instructor}/my-courses/${ref.courseId}`);
  await page
    .getByRole('link', { name: `Submissions for ${assignmentTitle}` })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: assignmentTitle }),
  ).toBeVisible();
};

// The student names in the list, top to bottom.
export const submissionRowNames = (page: Page) =>
  page.getByRole('row').getByRole('link');

// Opens a student's review page from the list.
export const openSubmissionReview = async (page: Page, student: string) => {
  await page.getByRole('link', { name: student }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: student }),
  ).toBeVisible();
};

const typeFeedback = async (page: Page, feedback: string) => {
  const editor = page.getByLabel('Feedback', { exact: true });
  await editor.click();
  await editor.pressSequentially(feedback);
};

// Fills the review form's points and feedback without sending.
export const fillGrade = async (
  page: Page,
  points: number,
  feedback?: string,
) => {
  await page.getByLabel('Points').fill(String(points));
  if (feedback) {
    await typeFeedback(page, feedback);
  }
};

// Returns the work with `points` and `feedback`, and waits for the grade.
export const returnSubmission = async (
  page: Page,
  points: number,
  feedback: string,
) => {
  await fillGrade(page, points, feedback);
  await page.getByRole('button', { name: 'Return', exact: true }).click();
  await expect(page.getByText(/^Returned: /)).toBeVisible();
};

// Asks the student to resubmit, with feedback, and waits for the request to
// show in the history.
export const requestResubmission = async (page: Page, feedback: string) => {
  await typeFeedback(page, feedback);
  await page.getByRole('button', { name: 'Request resubmission' }).click();
  await expect(page.getByText('Feedback history')).toBeVisible();
};

// Changes a returned grade through "Edit grade".
export const editGrade = async (page: Page, points: number) => {
  await page.getByRole('button', { name: 'Edit grade' }).click();
  await page.getByLabel('Points').fill(String(points));
  await page.getByRole('button', { name: 'Save grade' }).click();
  await expect(page.getByText(`Returned: ${points} /`)).toBeVisible();
};
