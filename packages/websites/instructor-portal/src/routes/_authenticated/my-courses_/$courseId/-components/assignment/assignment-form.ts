/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { plainText } from '../content-items/quiz/quiz-form';

// What an upload assignment's forms check before saving. instructor-api's
// `schema/assignment.ts` checks the same rules.

// instructor-api's MAX_ASSIGNMENT_POINTS; the portals import only its types.
export const MAX_ASSIGNMENT_POINTS = 1000;
export const MAX_ASSIGNMENT_TITLE = 200;

export type UploadAssignmentValues = {
  title: string;
  // A Tiptap document, as a JSON string; undefined until the editor is used.
  body: string | undefined;
  // The input's text, so a half-typed number can be told what's wrong.
  maxPoints: string;
  // A datetime-local input's value, or '' for no due date.
  dueAt: string;
};

export type UploadAssignmentErrors = Partial<
  Record<keyof UploadAssignmentValues, string>
>;

export const validateUploadAssignment = (
  values: UploadAssignmentValues,
  { withTitle = true }: { withTitle?: boolean } = {},
): UploadAssignmentErrors => {
  const errors: UploadAssignmentErrors = {};
  const title = values.title.trim();
  if (withTitle && !title) {
    errors.title = 'Assignment title is required';
  } else if (title.length > MAX_ASSIGNMENT_TITLE) {
    errors.title = `The title can be at most ${MAX_ASSIGNMENT_TITLE} characters`;
  }
  if (!values.body || !plainText(values.body)) {
    errors.body = 'Write the instructions students will follow';
  }
  const points = Number(values.maxPoints);
  if (
    !values.maxPoints.trim() ||
    !Number.isInteger(points) ||
    points < 1 ||
    points > MAX_ASSIGNMENT_POINTS
  ) {
    errors.maxPoints = `Max points is a whole number from 1 to ${MAX_ASSIGNMENT_POINTS}`;
  }
  if (values.dueAt && Number.isNaN(new Date(values.dueAt).getTime())) {
    errors.dueAt = 'Enter a valid due date';
  }
  return errors;
};

// A datetime-local value (local time, no zone) as the ISO instant the API takes.
export const dueAtToIso = (value: string) =>
  value ? new Date(value).toISOString() : undefined;

// An ISO instant as a datetime-local value in the browser's time zone.
export const isoToDueAt = (iso: string | undefined) => {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
