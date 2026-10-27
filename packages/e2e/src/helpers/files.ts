/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { fileURLToPath } from 'node:url';

// A one-page PDF saying "Discava e2e test file", written out by hand (a
// catalog, a page, its text and a Helvetica font) rather than by a tool, so
// it stays a few hundred bytes.
export const WORKSHEET_PDF = fileURLToPath(
  new URL('../files/worksheet.pdf', import.meta.url),
);
