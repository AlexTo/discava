/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { fileURLToPath } from 'node:url';
import { expect, type Locator } from '@playwright/test';

// A 3-second, 320x180 H.264/AAC clip (colour bars with a moving counter and a
// tone), small enough to commit and quick to transcode. To make it again:
//   docker run --rm -v "$PWD":/out mwader/static-ffmpeg:9.0.2 -y \
//     -f lavfi -i "testsrc2=size=320x180:rate=15:duration=3" \
//     -f lavfi -i "sine=frequency=440:duration=3" \
//     -c:v libx264 -preset veryslow -crf 32 -pix_fmt yuv420p \
//     -c:a aac -b:a 32k -ac 1 -movflags +faststart -shortest /out/three-seconds.mp4
export const THREE_SECOND_VIDEO = fileURLToPath(
  new URL('../files/three-seconds.mp4', import.meta.url),
);

// Waits for a <video> to load its stream (the transcoded HLS, through the
// portal's signed URL), then plays it muted, as browsers allow without a
// click, and checks that playback really moves on rather than sitting on a
// frame.
export const expectToPlay = async (video: Locator) => {
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.duration || 0), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  await video.evaluate(async (v: HTMLVideoElement) => {
    v.muted = true;
    await v.play();
  });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(1);
  expect(await video.evaluate((v: HTMLVideoElement) => v.error)).toBeNull();
};
