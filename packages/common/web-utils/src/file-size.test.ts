/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { fileKind, formatFileSize } from './file-size';

describe('formatFileSize', () => {
  it('says bytes below a kilobyte', () => {
    expect(formatFileSize(1)).toBe('1 byte');
    expect(formatFileSize(820)).toBe('820 bytes');
  });

  it('gives one decimal below 10 of a unit, and none above', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(14 * 1024 + 300)).toBe('14 KB');
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatFileSize(100 * 1024 * 1024)).toBe('100 MB');
    expect(formatFileSize(3 * 1024 ** 3)).toBe('3 GB');
  });
});

describe('fileKind', () => {
  it('names the file by its extension', () => {
    expect(fileKind('Week 1 slides.pptx')).toBe('PPTX');
    expect(fileKind('notes.pdf')).toBe('PDF');
  });

  it('falls back to "File" without one', () => {
    expect(fileKind('README')).toBe('File');
    expect(fileKind('.env')).toBe('File');
  });
});
