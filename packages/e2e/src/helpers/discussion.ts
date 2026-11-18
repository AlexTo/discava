/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomBytes } from 'node:crypto';

// A UUID v7 minted now, the id the discussion API wants for a new post: its
// first 48 bits are the milliseconds, which the API checks are recent.
export const newPostId = (now = Date.now()): string => {
  const bytes = randomBytes(10);
  bytes[0] = (bytes[0] & 0x0f) | 0x70;
  bytes[2] = (bytes[2] & 0x3f) | 0x80;
  const time = now.toString(16).padStart(12, '0').slice(-12);
  const random = bytes.toString('hex');
  return `${time.slice(0, 8)}-${time.slice(8)}-${random.slice(0, 4)}-${random.slice(4, 8)}-${random.slice(8)}`;
};
