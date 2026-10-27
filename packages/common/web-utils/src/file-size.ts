/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const UNITS = ['KB', 'MB', 'GB'] as const;

// A file size for people: "820 bytes", "14 KB", "1.5 MB". One decimal below
// 10 of a unit, none above, as file managers show them.
export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) {
    return bytes === 1 ? '1 byte' : `${bytes} bytes`;
  }
  let size = bytes;
  let unit: (typeof UNITS)[number] = 'KB';
  for (const next of UNITS) {
    size /= 1024;
    unit = next;
    if (size < 1024) {
      break;
    }
  }
  return `${size < 10 ? size.toFixed(1).replace(/\.0$/, '') : Math.round(size)} ${unit}`;
};

// What kind of file it is, from its name's extension: "PDF", "DOCX".
export const fileKind = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot + 1).toUpperCase() : 'File';
};
