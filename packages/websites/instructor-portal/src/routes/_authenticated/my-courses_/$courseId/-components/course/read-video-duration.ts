/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How long a video file runs, in seconds, as the browser reads it from the
 * file's own metadata; rejects when the browser can't play the file.
 */
export const readVideoDuration = (file: File): Promise<number> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    // A file the browser can neither read nor reject would leave the upload
    // waiting for ever.
    const timer = setTimeout(() => video.onerror?.(new Event('error')), 15_000);
    const done = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      done();
      resolve(video.duration);
    };
    video.onerror = () => {
      done();
      reject(new Error("Couldn't read the video"));
    };
    video.src = url;
  });
