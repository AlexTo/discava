/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  AmendGradeInputSchema,
  RequestResubmissionInputSchema,
  ReturnSubmissionInputSchema,
} from './assignment-submission.js';

const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [
      { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] },
    ],
  });

const base = {
  courseId: 'c1',
  contentItemId: 'i1',
  userId: 'u1',
  version: 1,
  reviewRevision: 0,
};

describe('return input', () => {
  const parse = (extra: Record<string, unknown>) =>
    ReturnSubmissionInputSchema.safeParse({ ...base, points: 5, ...extra });

  it('accepts points and optional feedback', () => {
    expect(parse({}).success).toBe(true);
    expect(parse({ feedback: doc('Well done') }).success).toBe(true);
  });

  it.each([-1, 1.005, Number.NaN])('refuses points %s', (points) => {
    expect(parse({ points }).success).toBe(false);
  });

  it('accepts two decimal places', () => {
    expect(parse({ points: 7.25 }).success).toBe(true);
  });

  it('refuses feedback of 20 001 characters', () => {
    const long = `${doc('x').slice(0, -3)}${'x'.repeat(20_001)}`;
    expect(parse({ feedback: long }).success).toBe(false);
  });

  it('refuses feedback that is not a Tiptap document', () => {
    expect(parse({ feedback: 'plain text' }).success).toBe(false);
  });
});

describe('request resubmission input', () => {
  const parse = (feedback: unknown) =>
    RequestResubmissionInputSchema.safeParse({ ...base, feedback });

  it('accepts feedback with text', () => {
    expect(parse(doc('Please redo part 2')).success).toBe(true);
  });

  it('refuses feedback with no text', () => {
    expect(parse(doc('')).success).toBe(false);
  });

  it('needs feedback', () => {
    expect(parse(undefined).success).toBe(false);
  });
});

describe('amend input', () => {
  it('needs a revision and points, not a version', () => {
    expect(
      AmendGradeInputSchema.safeParse({
        courseId: 'c1',
        contentItemId: 'i1',
        userId: 'u1',
        reviewRevision: 1,
        points: 9,
      }).success,
    ).toBe(true);
  });

  it('refuses negative points', () => {
    expect(
      AmendGradeInputSchema.safeParse({
        courseId: 'c1',
        contentItemId: 'i1',
        userId: 'u1',
        reviewRevision: 1,
        points: -1,
      }).success,
    ).toBe(false);
  });
});
