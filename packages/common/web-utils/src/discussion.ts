/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// The portals cannot import core-table, so its discussion limits are repeated
// here; packages/apis/core-api/src/schema/discussion.test.ts asserts they are
// equal.
export const DISCUSSION_TITLE_MAX = 120;
export const DISCUSSION_BODY_MAX = 4000;
export const DISCUSSION_MAX_VISIBLE_REPLIES = 500;

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

// A UUID v7 minted at `now`: the milliseconds in the first 48 bits, so the
// API can check the id was made just now.
export const newPostId = (now = Date.now()): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const time = now.toString(16).padStart(12, '0').slice(-12);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const random = hex(bytes.slice(6));
  return `${time.slice(0, 8)}-${time.slice(8)}-${random.slice(0, 4)}-${random.slice(4, 8)}-${random.slice(8)}`;
};

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['week', 7 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
];

// "3 days ago", or "just now" for under a minute.
export const relativeTime = (iso: string, now = Date.now()): string => {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      return formatter.format(Math.trunc(seconds / size), unit);
    }
  }
  return 'just now';
};
