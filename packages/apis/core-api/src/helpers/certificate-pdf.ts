/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type FontInput,
  measureText,
  PDF,
  rgb,
  StandardFonts,
} from '@libpdf/core';

export interface ICertificatePdfInput {
  learnerName: string;
  courseTitle: string;
  completedAt: string;
  /** In display form, e.g. 0123-4567-89AB-CDEF. */
  certificateId: string;
  verifyUrl: string;
  /** What the certificate confirms, one entry per line. */
  statement: string[];
}

// Landscape A4, in points.
const WIDTH = 841.89;
const HEIGHT = 595.28;
const MARGIN = 60;

// The standard fonts draw WinAnsi only: printable ASCII, Latin-1 and the
// punctuation WinAnsi keeps in 0x80 to 0x9F (dashes, curly quotes, the
// ellipsis, the euro sign, ...). Everything else (CJK, emoji, other scripts)
// becomes one `?` per character.
const WIN_ANSI_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

const sanitise = (text: string): string =>
  Array.from(text, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return (code >= 0x20 && code <= 0x7e) ||
      (code >= 0xa0 && code <= 0xff) ||
      WIN_ANSI_EXTRAS.has(char)
      ? char
      : '?';
  }).join('');

/**
 * The date a certificate shows, in UTC so it reads the same wherever and
 * whenever it is viewed, e.g. `19 November 2026`. The PDF prints it and the
 * certificate page shows the string the API returns.
 */
export const formatDate = (completedAt: string): string => {
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

// Breaks `text` at spaces into lines no wider than `width`.
const wrap = (
  text: string,
  font: FontInput,
  size: number,
  width: number,
): string[] => {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    const next = current ? `${current} ${word}` : word;
    if (current && measureText(next, font, size) > width) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  lines.push(current);
  return lines;
};

/**
 * A certificate as one landscape A4 page: heading, learner, course, statement
 * of what was assessed, date, ID and verification URL. Text that wouldn't fit between the margins shrinks
 * (to a floor, below which it is cut with an ellipsis) so the page stays one.
 */
export const drawCertificatePdf = async (
  input: ICertificatePdfInput,
): Promise<Uint8Array> => {
  const pdf = PDF.create();
  const page = pdf.addPage({ width: WIDTH, height: HEIGHT });
  const regular = StandardFonts.Helvetica;
  const bold = StandardFonts.HelveticaBold;
  const maxWidth = WIDTH - MARGIN * 2;

  const centred = (
    rawText: string,
    y: number,
    font: FontInput,
    size: number,
    minSize = 8,
  ) => {
    let text = sanitise(rawText);
    let fitted = size;
    while (fitted > minSize && measureText(text, font, fitted) > maxWidth) {
      fitted -= 1;
    }
    while (text.length > 1 && measureText(text, font, fitted) > maxWidth) {
      text = `${text.slice(0, -4)}...`;
    }
    page.drawText(text, {
      x: (WIDTH - measureText(text, font, fitted)) / 2,
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
  // Under the course title, wrapped to the margins, shrinking the line gap
  // when there are many so the page stays one.
  const statementSize = 10;
  const lines = input.statement.flatMap((line) =>
    wrap(sanitise(line), regular, statementSize, maxWidth),
  );
  const step = Math.min(14, 60 / Math.max(1, lines.length - 1));
  lines.forEach((line, index) => {
    centred(line, 224 - index * step, regular, statementSize);
  });

  centred(`Completed on ${formatDate(input.completedAt)}`, 145, regular, 16);
  centred(`Certificate ID: ${input.certificateId}`, 120, regular, 13);
  centred(`Verify at ${input.verifyUrl}`, 95, regular, 11);

  return pdf.save();
};
