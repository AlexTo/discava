/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import Hls from 'hls.js';
import { useEffect, useRef } from 'react';

/**
 * Plays a lesson video's HLS stream (master.m3u8) from the lesson media
 * CloudFront distribution. Access is through the signed cookies the API set
 * when it returned `url` (instructor-api's contentItem.createVideoUrl,
 * core-api's contentItem.videoUrl), so every request for the manifest,
 * renditions and segments sends credentials.
 *
 * `nodownload` and the blocked context menu only deter casual downloading
 * through the browser's own UI, not a determined user. `noremoteplayback`
 * hides casting (Chromecast, AirPlay): the receiving device would fetch the
 * stream itself, without the viewer's signed cookies, and fail.
 * Picture-in-picture stays available, for watching while taking notes.
 */
export function HlsVideo({
  url,
  title,
  className,
}: {
  url: string;
  // What the player is called to assistive technology.
  title?: string;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    // Only 'probably' reliably means native HLS support (Safari): Chromium
    // answers 'maybe' too, despite not being able to play it.
    if (video.canPlayType('application/vnd.apple.mpegurl') === 'probably') {
      video.src = url;
      return;
    }

    if (!Hls.isSupported()) {
      return;
    }

    // The cookies are on the API's parent domain, so hls.js's own
    // cross-origin requests need to send them.
    const hls = new Hls({
      xhrSetup: (xhr) => {
        xhr.withCredentials = true;
      },
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    return () => hls.destroy();
  }, [url]);

  return (
    <video
      ref={videoRef}
      data-slot="hls-video"
      controls
      controlsList="nodownload noremoteplayback"
      onContextMenu={(event) => event.preventDefault()}
      aria-label={title}
      className={className}
    />
  );
}
