/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { expect, type Locator, type Page } from '@playwright/test';

// Two 1600x900 JPEGs, different enough to tell apart (SMPTE bars, and a test
// pattern), made with:
//   docker run --rm -v "$PWD":/out mwader/static-ffmpeg:9.0.2 -y \
//     -f lavfi -i "smptehdbars=size=1600x900" -frames:v 1 -q:v 12 /out/course-image-bars.jpg
//   (and "testsrc2=size=1600x900" for course-image-pattern.jpg)
const file = (name: string) =>
  fileURLToPath(new URL(`../files/${name}`, import.meta.url));
export const COURSE_IMAGE_BARS = file('course-image-bars.jpg');
export const COURSE_IMAGE_PATTERN = file('course-image-pattern.jpg');

// Course images are decorative (alt="", the title is beside them), so they're
// found by where they're served from: the public media bucket (S3Mock
// locally).
export const publicMediaImages = (scope: Page | Locator) =>
  scope.locator('img[src*="discava-public-media"]');

// Checks an <img> really loaded, at `width` pixels wide (a course image is
// cropped to 1280x720), rather than only being in the page.
export const expectImageLoaded = async (image: Locator, width: number) => {
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth), {
      timeout: 10_000,
    })
    .toBe(width);
};

// A solid-colour PNG of any size, made in memory, for the brand images (an
// icon at least 192 × 192, a logo of any shape) without fixture files.
export const solidPng = (width: number, height: number): Buffer => {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const check = Buffer.alloc(4);
    check.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, check]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  // Each row: a filter byte, then width × 3 bytes of blue.
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) {
    row[2 + x * 3 + 1] = 0x4e;
    row[2 + x * 3 + 2] = 0xd8;
    row[2 + x * 3] = 0x1d;
  }
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

// A 4:1 SVG logo, and one with a script in it, which the server refuses.
export const LOGO_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100"><rect width="400" height="100" fill="#1d4ed8"/><text x="20" y="62" font-size="40" fill="#fff">Acme</text></svg>',
);
export const SCRIPTED_LOGO_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100"><script>alert(1)</script><rect width="400" height="100"/></svg>',
);

// The brand image fixtures, made in memory: a 512 × 512 icon, a 1200 × 630
// share image, and a non-square icon the server refuses.
export const ICON_PNG = solidPng(512, 512);
export const SHARE_IMAGE_PNG = solidPng(1200, 630);
export const NON_SQUARE_ICON_PNG = solidPng(512, 256);
