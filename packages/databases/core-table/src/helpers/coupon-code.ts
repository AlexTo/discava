/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomBytes } from 'node:crypto';

// Crockford base32: no I, L, O or U, so a code read aloud or off a screen
// isn't mistaken.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_PATTERN = /^[A-Z0-9-]{4,24}$/;

/**
 * A typed code as stored: trimmed and upper-cased. `undefined` unless it is
 * 4 to 24 characters of A-Z, 0-9 and -.
 */
export const normaliseCouponCode = (input: string): string | undefined => {
  const code = input.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : undefined;
};

/** A random code of 8 Crockford base32 characters, written XXXX-XXXX. */
export const generateCouponCode = (): string => {
  // 256 is a multiple of 32, so masking a byte picks each letter evenly.
  const chars = Array.from(randomBytes(8), (byte) => ALPHABET[byte & 31]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
};
