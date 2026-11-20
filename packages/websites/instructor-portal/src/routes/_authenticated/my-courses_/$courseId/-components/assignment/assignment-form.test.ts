/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  dueAtToIso,
  isoToDueAt,
  MAX_ASSIGNMENT_POINTS,
  type UploadAssignmentValues,
  validateUploadAssignment,
} from './assignment-form';

const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

const valid: UploadAssignmentValues = {
  title: 'Essay',
  body: doc('Write about it.'),
  maxPoints: '10',
  dueAt: '',
};

describe('validateUploadAssignment', () => {
  it('accepts a complete assignment, with or without a due date', () => {
    expect(validateUploadAssignment(valid)).toEqual({});
    expect(
      validateUploadAssignment({ ...valid, dueAt: '2030-01-01T09:00' }),
    ).toEqual({});
  });

  it('requires a title, unless the form has none', () => {
    expect(validateUploadAssignment({ ...valid, title: '  ' }).title).toMatch(
      /required/,
    );
    expect(
      validateUploadAssignment({ ...valid, title: '' }, { withTitle: false }),
    ).toEqual({});
  });

  it('requires instructions with some text in them', () => {
    expect(validateUploadAssignment({ ...valid, body: undefined }).body).toBe(
      'Write the instructions students will follow',
    );
    expect(
      validateUploadAssignment({
        ...valid,
        body: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }),
      }).body,
    ).toBeDefined();
  });

  it.each(['', '0', '-3', '2.5', 'abc', String(MAX_ASSIGNMENT_POINTS + 1)])(
    'rejects %j as max points',
    (maxPoints) => {
      expect(
        validateUploadAssignment({ ...valid, maxPoints }).maxPoints,
      ).toMatch(/whole number from 1 to 1000/);
    },
  );

  it('accepts the limits of max points', () => {
    for (const maxPoints of ['1', String(MAX_ASSIGNMENT_POINTS)]) {
      expect(validateUploadAssignment({ ...valid, maxPoints })).toEqual({});
    }
  });
});

describe('due dates', () => {
  it('turns a local datetime into an ISO instant, and nothing into nothing', () => {
    expect(dueAtToIso('2030-01-01T09:30')).toBe(
      new Date(2030, 0, 1, 9, 30).toISOString(),
    );
    expect(dueAtToIso('')).toBeUndefined();
  });

  it('round-trips an ISO instant through a datetime-local value', () => {
    const iso = new Date(2030, 5, 7, 18, 5).toISOString();
    expect(isoToDueAt(iso)).toBe('2030-06-07T18:05');
    expect(dueAtToIso(isoToDueAt(iso))).toBe(iso);
    expect(isoToDueAt(undefined)).toBe('');
  });
});
