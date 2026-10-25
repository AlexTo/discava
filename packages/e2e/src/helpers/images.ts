/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { fileURLToPath } from 'node:url';
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
