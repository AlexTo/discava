/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { PDFDocument, type PDFFont, rgb, StandardFonts } from 'pdf-lib';

export interface ICertificatePdfInput {
  learnerName: string;
  courseTitle: string;
  completedAt: string;
  /** In display form, e.g. 0123-4567-89AB-CDEF. */
  certificateId: string;
  verifyUrl: string;
}

// Landscape A4, in points.
const WIDTH = 841.89;
const HEIGHT = 595.28;
const MARGIN = 60;

// The standard fonts draw WinAnsi only. Printable ASCII and Latin-1 are the
// same in both; everything else (CJK, emoji, other scripts) becomes one `?`
// per character.
const sanitise = (text: string): string =>
  Array.from(text, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)
      ? char
      : '?';
  }).join('');

const formatDate = (completedAt: string): string => {
  const date = new Date(completedAt);
  return Number.isNaN(date.getTime())
    ? sanitise(completedAt)
    : date.toLocaleDateString('en-AU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });
};

/**
 * A certificate as one landscape A4 page: heading, learner, course, date, ID
 * and verification URL. Text that wouldn't fit between the margins shrinks
 * (to a floor, below which it is cut with an ellipsis) so the page stays one.
 */
export const drawCertificatePdf = async (
  input: ICertificatePdfInput,
): Promise<Uint8Array> => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([WIDTH, HEIGHT]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const maxWidth = WIDTH - MARGIN * 2;

  const centred = (
    rawText: string,
    y: number,
    font: PDFFont,
    size: number,
    minSize = 8,
  ) => {
    let text = sanitise(rawText);
    let fitted = size;
    while (
      fitted > minSize &&
      font.widthOfTextAtSize(text, fitted) > maxWidth
    ) {
      fitted -= 1;
    }
    while (text.length > 1 && font.widthOfTextAtSize(text, fitted) > maxWidth) {
      text = `${text.slice(0, -4)}...`;
    }
    page.drawText(text, {
      x: (WIDTH - font.widthOfTextAtSize(text, fitted)) / 2,
      y,
      size: fitted,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
  };

  page.drawRectangle({
    x: 20,
    y: 20,
    width: WIDTH - 40,
    height: HEIGHT - 40,
    borderColor: rgb(0.2, 0.3, 0.5),
    borderWidth: 3,
  });

  centred('Certificate of Completion', 440, bold, 38);
  centred('This certifies that', 390, regular, 16);
  centred(input.learnerName, 340, bold, 32);
  centred('has completed the course', 295, regular, 16);
  centred(input.courseTitle, 250, bold, 26);
  centred(`Completed on ${formatDate(input.completedAt)}`, 200, regular, 16);
  centred(`Certificate ID: ${input.certificateId}`, 120, regular, 13);
  centred(`Verify at ${input.verifyUrl}`, 95, regular, 11);

  return pdf.save();
};
