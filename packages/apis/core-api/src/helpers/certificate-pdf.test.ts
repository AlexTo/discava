/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { drawCertificatePdf } from './certificate-pdf.js';

const base = {
  learnerName: 'Erin Nguyen',
  courseTitle: 'Intro to Testing',
  completedAt: '2026-11-10T00:00:00.000Z',
  certificateId: '0123-4567-89AB-CDEF',
  verifyUrl: 'https://discava.example.com/certificates/0123-4567-89AB-CDEF',
};

describe('drawCertificatePdf', () => {
  it('returns a one-page landscape A4 PDF', async () => {
    const bytes = await drawCertificatePdf(base);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('%PDF');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    const { width, height } = pdf.getPage(0).getSize();
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
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
