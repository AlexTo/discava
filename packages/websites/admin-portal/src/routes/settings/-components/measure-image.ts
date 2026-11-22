/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ImageSize {
  width: number;
  height: number;
}

// An SVG's size from its viewBox, else its width and height, as the server
// reads it (admin-api's brand-image helper).
const svgSize = (text: string): ImageSize | undefined => {
  const svg = new DOMParser()
    .parseFromString(text, 'image/svg+xml')
    .querySelector('svg');
  if (!svg) {
    return undefined;
  }
  const box = svg
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (box?.length === 4 && box[2]! > 0 && box[3]! > 0) {
    return { width: box[2]!, height: box[3]! };
  }
  const width = Number.parseFloat(svg.getAttribute('width') ?? '');
  const height = Number.parseFloat(svg.getAttribute('height') ?? '');
  return width > 0 && height > 0 ? { width, height } : undefined;
};

const rasterSize = (file: File): Promise<ImageSize | undefined> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(undefined);
    };
    image.src = url;
  });

/** The pixel (or viewBox) size of an image file, or undefined if it can't be read. */
export const measureImage = async (
  file: File,
): Promise<ImageSize | undefined> =>
  file.type === 'image/svg+xml' ? svgSize(await file.text()) : rasterSize(file);
