/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Area } from 'react-easy-crop';

// Every course image is stored at this size: big enough for the widest place
// it's shown, small enough (a few hundred KB) to load quickly on a card.
export const COURSE_IMAGE_SIZE = { width: 1280, height: 720 };
// A profile photo is square.
export const PROFILE_PHOTO_SIZE = { width: 512, height: 512 };
const JPEG_QUALITY = 0.85;

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', () =>
      reject(new Error("Couldn't read that image")),
    );
    image.src = src;
  });

/**
 * Cuts `area` (in the source image's pixels, as react-easy-crop reports it)
 * out of the image at `src`, scaled to `size` (a course image's by default),
 * as a JPEG. Whatever was uploaded (PNG, WebP, a huge photo), what's stored
 * is always the same size and type.
 */
export const cropToJpeg = async (
  src: string,
  area: Area,
  size: { width: number; height: number } = COURSE_IMAGE_SIZE,
): Promise<Blob> => {
  const image = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error("Couldn't crop the image");
  }
  // JPEG has no transparency, so a transparent PNG gets white behind it
  // rather than black.
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Couldn't crop the image")),
      'image/jpeg',
      JPEG_QUALITY,
    ),
  );
};
