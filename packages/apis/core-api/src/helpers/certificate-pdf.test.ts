/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { PDF } from '@libpdf/core';
import { describe, expect, it } from 'vitest';
import { drawCertificatePdf, formatDate } from './certificate-pdf.js';

const base = {
  learnerName: 'Erin Nguyen',
  courseTitle: 'Intro to Testing',
  completedAt: '2026-11-10T00:00:00.000Z',
  certificateId: '0123-4567-89AB-CDEF',
  verifyUrl: 'https://discava.example.com/certificates/0123-4567-89AB-CDEF',
  statement: [
    'Completed all 14 items of the course.',
    'Passed 3 assessed quizzes. Pass mark: 70%.',
    'Overall score: 80–89%.',
    'Course length: 12 hours.',
  ],
};

describe('drawCertificatePdf', () => {
  it('returns a one-page landscape A4 PDF', async () => {
    const bytes = await drawCertificatePdf(base);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('%PDF');
    const pdf = await PDF.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    const { width, height } = pdf.getPage(0)!;
    expect(Math.round(width)).toBe(842);
    expect(Math.round(height)).toBe(595);
  });

  it.each([
    ['an accented name', { learnerName: 'Zoë Núñez' }],
    ['a CJK name', { learnerName: '山田太郎' }],
    ['an emoji title', { courseTitle: 'Party 🎉 course' }],
    ['a 300-character title', { courseTitle: 'A'.repeat(300) }],
    ['a 300-character name', { learnerName: 'W'.repeat(300) }],
    ['an empty name', { learnerName: '' }],
    ['an unparseable date', { completedAt: 'not a date' }],
  ])('draws one page for %s', async (_, overrides) => {
    const bytes = await drawCertificatePdf({ ...base, ...overrides });
    expect((await PDF.load(bytes)).getPageCount()).toBe(1);
  });
});

describe('the statement', () => {
  const textOf = async (bytes: Uint8Array) =>
    (await PDF.load(bytes))
      .extractText()
      .map((page) => page.text)
      .join(' ')
      .replace(/\s+/g, ' ');

  it('draws every line', async () => {
    const text = await textOf(await drawCertificatePdf(base));
    expect(text).toContain('Completed all 14 items of the course.');
    expect(text).toContain('Passed 3 assessed quizzes. Pass mark: 70%.');
    expect(text).toContain('Overall score: 80–89%.');
    expect(text).toContain('Course length: 12 hours.');
  });

  // FR-013: the same words as the verification page, which prints the en dash.
  it('keeps the punctuation the standard fonts can draw', async () => {
    const text = await textOf(
      await drawCertificatePdf({
        ...base,
        learnerName: 'Seán O’Brien',
        statement: ['Overall score: 90–100%.', '“Quoted” — and so on…'],
      }),
    );
    expect(text).toContain('Seán O’Brien');
    expect(text).toContain('Overall score: 90–100%.');
    expect(text).toContain('“Quoted” — and so on…');
  });

  it('still prints a ? for each character the standard fonts cannot draw', async () => {
    const text = await textOf(
      await drawCertificatePdf({ ...base, learnerName: '山田 🎉' }),
    );
    expect(text).toContain('?? ?');
  });

  it('stays on one page in the longest case', async () => {
    const bytes = await drawCertificatePdf({
      ...base,
      learnerName: 'W'.repeat(300),
      courseTitle: 'A'.repeat(300),
      statement: [
        'Completed all 140 items of the course.',
        `Passed 30 assessed quizzes. Pass marks: 60% to 80%. ${'More words. '.repeat(20)}`,
        'Graded assignments returned with at least 60%: 2.',
        'Overall score: 90–100%.',
        'Course length: 120 hours.',
      ],
    });
    expect((await PDF.load(bytes)).getPageCount()).toBe(1);
  });
});

describe('the certificate date', () => {
  it('is the UTC day, whatever the time zone', () => {
    expect(formatDate('2026-11-19T19:48:06Z')).toBe('19 November 2026');
  });

  it('is the one the PDF prints', async () => {
    const bytes = await drawCertificatePdf({
      ...base,
      completedAt: '2026-11-19T19:48:06Z',
    });
    const text = (await PDF.load(bytes))
      .extractText()
      .map((page) => page.text)
      .join(' ');
    expect(text).toContain('Completed on 19 November 2026');
  });
});
