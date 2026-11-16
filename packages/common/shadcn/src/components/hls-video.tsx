/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  createPositionReporter,
  type PlayerPosition,
} from '@discava/common-web-utils/video-player';
import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { formatTime, VideoControls } from './video-controls';

// How long the "Resumed at" notice stays, unless the viewer plays first.
const RESUME_NOTICE_MS = 8000;

/**
 * Plays a lesson video's HLS stream (master.m3u8) from the lesson media
 * CloudFront distribution. Access is through the signed cookies the API set
 * when it returned `url` (instructor-api's contentItem.createVideoUrl,
 * core-api's contentItem.videoUrl), so with `withCredentials`, as the API
 * says, every request for the manifest, renditions and segments sends them.
 * Local dev's unsigned S3Mock URLs come without (#137).
 *
 * `nodownload` and the blocked context menu only deter casual downloading
 * through the browser's own UI, not a determined user. `noremoteplayback`
 * hides casting (Chromecast, AirPlay): the receiving device would fetch the
 * stream itself, without the viewer's signed cookies, and fail.
 * Picture-in-picture stays available, for watching while taking notes.
 *
 * The browser's native controls are replaced by `VideoControls`, for speed,
 * volume and keyboard shortcuts that work the same in every browser.
 * `className` styles the player as a whole, not just the `<video>`.
 *
 * With `resumeAt` above 0 the video seeks there once it loads, stays paused,
 * and says "Resumed at m:ss" with a "Start over" button until it plays or
 * 8 seconds pass. With `onPositionChange` the player reports where the viewer
 * is (every 10 seconds while playing, and on pause, seek end and leaving the
 * page) so it can be saved; without it, as in the instructor's preview,
 * nothing is reported.
 */
export function HlsVideo({
  url,
  withCredentials,
  title,
  className,
  resumeAt = 0,
  onPositionChange,
}: {
  url: string;
  // The API's `withCredentials` for this `url`.
  withCredentials: boolean;
  // What the player is called to assistive technology.
  title?: string;
  className?: string;
  // Seconds to start from; 0 starts at the beginning.
  resumeAt?: number;
  onPositionChange?: (position: PlayerPosition) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [resumedAt, setResumedAt] = useState<number>();
  // The latest callback, so a new one each render doesn't restart playback
  // or the reporter.
  const onPositionChangeRef = useRef(onPositionChange);
  onPositionChangeRef.current = onPositionChange;

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
        xhr.withCredentials = withCredentials;
      },
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    return () => hls.destroy();
  }, [url, withCredentials]);

  // Resume where the viewer left off: seek once the video knows its length,
  // without playing, and report the position from there on.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    setResumedAt(undefined);
    const reporter = createPositionReporter(
      (position) => onPositionChangeRef.current?.(position),
      { initialPosition: resumeAt },
    );
    const tick = () => {
      if (!video.paused && onPositionChangeRef.current) {
        reporter.tick(video.currentTime, video.duration);
      }
    };
    const flush = () => {
      if (onPositionChangeRef.current) {
        reporter.flush(video.currentTime, video.duration);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flush();
      }
    };
    const dismissNotice = () => setResumedAt(undefined);

    let resumed = resumeAt <= 0;
    const resume = () => {
      if (resumed) {
        return;
      }
      resumed = true;
      // Not onto the very end, where there is nothing left to watch.
      const target = Number.isFinite(video.duration)
        ? Math.min(resumeAt, Math.max(0, video.duration - 1))
        : resumeAt;
      video.currentTime = target;
      setResumedAt(target);
    };
    if (video.readyState >= 1) {
      resume();
    }

    video.addEventListener('loadedmetadata', resume);
    video.addEventListener('timeupdate', tick);
    video.addEventListener('pause', flush);
    video.addEventListener('seeked', flush);
    video.addEventListener('play', dismissNotice);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      video.removeEventListener('loadedmetadata', resume);
      video.removeEventListener('timeupdate', tick);
      video.removeEventListener('pause', flush);
      video.removeEventListener('seeked', flush);
      video.removeEventListener('play', dismissNotice);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [url, resumeAt]);

  useEffect(() => {
    if (resumedAt === undefined) {
      return;
    }
    const timer = setTimeout(() => setResumedAt(undefined), RESUME_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [resumedAt]);

  const startOver = () => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = 0;
    }
    setResumedAt(undefined);
  };

  return (
    <VideoControls className={className}>
      <video
        ref={videoRef}
        data-slot="hls-video"
        controlsList="nodownload noremoteplayback"
        onContextMenu={(event) => event.preventDefault()}
        aria-label={title}
        className="size-full"
      />
      {resumedAt !== undefined && (
        <div
          role="status"
          className="absolute top-2 left-2 flex items-center gap-2 rounded-md bg-black/80 px-3 py-1.5 text-sm text-white"
        >
          <span>Resumed at {formatTime(resumedAt)}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={startOver}
            className="hover:bg-white/20 hover:text-white"
          >
            Start over
          </Button>
        </div>
      )}
    </VideoControls>
  );
}
