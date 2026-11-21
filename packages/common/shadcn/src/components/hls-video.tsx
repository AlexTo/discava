/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createPositionReporter,
  loadPreferences,
  type PlayerPosition,
  savePreferences,
} from '@discava/common-web-utils/video-player';
import {
  cuesAtEnd,
  cuesReached,
  type PlayerCue,
  positionBeforeCue,
} from '@discava/common-web-utils/video-questions';
import {
  activeCueIndex,
  parseWebVtt,
  type TranscriptCue,
} from '@discava/common-web-utils/webvtt';
import { cn } from 'cn';
import Hls from 'hls.js';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { TranscriptPanel } from './transcript-panel';
import { Button } from './ui/button';
import {
  formatTime,
  type LoadedCaption,
  VideoControls,
} from './video-controls';

// Where cues sit, in lines up from the bottom of the video: the browser draws
// them on the last line, under the control bar while it shows. Applied only to
// cues that don't place themselves (a `line` setting in an uploaded file wins).
const CAPTION_LINE_FROM_BOTTOM = -4;

const liftCues = (track: TextTrack): void => {
  for (const cue of Array.from(track.cues ?? [])) {
    if ('line' in cue && cue.line === 'auto') {
      (cue as VTTCue).line = CAPTION_LINE_FROM_BOTTOM;
    }
  }
};

// A `<track>` that lifts its cues once the browser has loaded them. React has
// no onLoad for it, so the native event is listened to.
const CaptionTrack = ({ caption }: { caption: LoadedCaption }) => {
  const ref = useRef<HTMLTrackElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const lift = () => liftCues(element.track);
    element.addEventListener('load', lift);
    return () => element.removeEventListener('load', lift);
  }, []);
  return (
    <track
      ref={ref}
      data-track-id={caption.trackId}
      kind="captions"
      srcLang={caption.language}
      label={caption.label}
      src={caption.src}
    />
  );
};

// How long the "Resumed at" notice stays, unless the viewer plays first.
const RESUME_NOTICE_MS = 8000;

/** A caption track as the API lists it (core-api's `videoUrl`). */
export interface PlayerCaption {
  trackId: string;
  language: string;
  label: string;
  isDefault: boolean;
  // Plain CloudFront URL, authorised by the signed cookies.
  url: string;
}

// Fetches each caption file and holds it as a blob URL, which a `<track>` can
// load whatever the page's origin and cookies. The fetch sends the signed
// cookies only with `withCredentials`, as hls.js does (a native `<track src>`
// across origins applies `crossorigin` unevenly between browsers, and S3Mock
// refuses credentialed requests locally). A file that fails to load is
// skipped and named in the notice; it never affects playback. Tracks appear
// as their files arrive, in the API's order. The blob URLs are revoked when
// the tracks change and on unmount.
function useCaptionFiles(
  captions: PlayerCaption[] | undefined,
  withCredentials: boolean,
) {
  const [files, setFiles] = useState<
    Record<string, { src: string; cues: TranscriptCue[] } | null>
  >({});
  const signature = (captions ?? []).map((c) => `${c.trackId}@${c.url}`).join();

  // biome-ignore lint/correctness/useExhaustiveDependencies: `signature` stands for `captions`, which a refetch replaces with equal tracks
  useEffect(() => {
    setFiles({});
    if (!captions?.length) {
      return;
    }
    let cancelled = false;
    const blobUrls: string[] = [];
    for (const caption of captions) {
      fetch(
        caption.url,
        withCredentials ? { credentials: 'include' } : undefined,
      )
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return response.text();
        })
        .then((text) => {
          // Typed by us, not by the server: the player needs text/vtt.
          const src = URL.createObjectURL(
            new Blob([text], { type: 'text/vtt' }),
          );
          if (cancelled) {
            URL.revokeObjectURL(src);
            return;
          }
          blobUrls.push(src);
          const cues = parseWebVtt(text);
          setFiles((current) => ({
            ...current,
            [caption.trackId]: { src, cues },
          }));
        })
        .catch(() => {
          if (!cancelled) {
            setFiles((current) => ({ ...current, [caption.trackId]: null }));
          }
        });
    }
    return () => {
      cancelled = true;
      for (const src of blobUrls) {
        URL.revokeObjectURL(src);
      }
    };
  }, [signature, withCredentials]);

  const loaded: LoadedCaption[] = [];
  const failed: string[] = [];
  for (const caption of captions ?? []) {
    const file = files[caption.trackId];
    if (file) {
      loaded.push({ ...caption, ...file });
    } else if (file === null) {
      failed.push(caption.label);
    }
  }
  return {
    loaded,
    notice: failed.length
      ? `Couldn't load captions: ${failed.join(', ')}.`
      : undefined,
  };
}

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
 * With `captions`, the player offers a captions menu (see
 * `useCaptionFiles` for how the files load); without any, it has no such
 * control. The browser shows the cue text as plain text, a few lines up so
 * the control bar doesn't cover it.
 *
 * With `transcript`, the control bar has a "Transcript" button that opens a
 * panel of the chosen caption track's lines (see `TranscriptPanel`): beside
 * the video on a wide screen, below it on a phone. The current line follows
 * playback, and choosing a line seeks there and plays. Open or closed is
 * remembered with the player preferences.
 *
 * With `resumeAt` above 0 the video seeks there once it loads, stays paused,
 * and says "Resumed at m:ss" with a "Start over" button until it plays or
 * 8 seconds pass. With `onPositionChange` the player reports where the viewer
 * is (every 10 seconds while playing, and on pause, seek end and leaving the
 * page) so it can be saved; without it, as in the instructor's preview,
 * nothing is reported. With `onTimeChange` it also reports the current time
 * on every time update and after a seek.
 *
 * With `cues` (questions asked inside the video), `onCue` is called with the
 * ids of the unanswered cues playback reaches (`reached`, all of those at one
 * moment) and of those left at the end (`ended`). A seek reaches nothing:
 * not while seeking, nor in the time update after it. While `overlay` is set
 * the video is paused (see `VideoControls`), and the position reported is
 * just before the cue that opened it, so a viewer who leaves comes back to it.
 */
export function HlsVideo({
  url,
  withCredentials,
  title,
  className,
  captions,
  resumeAt = 0,
  autoPlay = false,
  transcript = false,
  onPositionChange,
  onTimeChange,
  cues,
  onCue,
  overlay,
  onOverlayDismiss,
}: {
  url: string;
  // The API's `withCredentials` for this `url`.
  withCredentials: boolean;
  // What the player is called to assistive technology.
  title?: string;
  className?: string;
  // The video's caption tracks, from the API.
  captions?: PlayerCaption[];
  // Seconds to start from; 0 starts at the beginning.
  resumeAt?: number;
  // Starts playing as soon as it can, for a video the viewer just asked to
  // play (the browser allows it after their click).
  autoPlay?: boolean;
  // Offers the transcript panel (needs `captions`).
  transcript?: boolean;
  onPositionChange?: (position: PlayerPosition) => void;
  // Called with the video's current time in seconds on each time update and
  // after a seek, so a caller can follow the playhead.
  onTimeChange?: (seconds: number) => void;
  // Questions to ask, as markers and moments; absent or empty changes nothing.
  cues?: PlayerCue[];
  onCue?: (cueIds: string[], reason: 'reached' | 'chosen' | 'ended') => void;
  // Shown over the video while set; the video stays paused.
  overlay?: ReactNode;
  onOverlayDismiss?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [resumedAt, setResumedAt] = useState<number>();
  const captionFiles = useCaptionFiles(captions, withCredentials);
  const panelId = useId();
  const [transcriptOpen, setTranscriptOpen] = useState(
    () => transcript && loadPreferences().transcriptOpen,
  );
  const [transcriptTrack, setTranscriptTrack] = useState<LoadedCaption>();
  const [currentTime, setCurrentTime] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  // The latest callback, so a new one each render doesn't restart playback
  // or the reporter.
  const onPositionChangeRef = useRef(onPositionChange);
  onPositionChangeRef.current = onPositionChange;
  const onTimeChangeRef = useRef(onTimeChange);
  onTimeChangeRef.current = onTimeChange;
  const cuesRef = useRef(cues);
  cuesRef.current = cues;
  const onCueRef = useRef(onCue);
  onCueRef.current = onCue;
  // The cue that opened the overlay now showing, while one does.
  const openCueRef = useRef<PlayerCue | undefined>(undefined);
  const hasOverlay = overlay !== undefined && overlay !== null;
  if (!hasOverlay) {
    openCueRef.current = undefined;
  }
  // Read when the video loads, not a reason to resume again: the saved
  // position the caller holds moves on while the viewer watches.
  const resumeAtRef = useRef(resumeAt);
  resumeAtRef.current = resumeAt;

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

    const resumeAt = resumeAtRef.current;
    setResumedAt(undefined);
    const reporter = createPositionReporter(
      (position) => onPositionChangeRef.current?.(position),
      { initialPosition: resumeAt },
    );
    const reportTime = () => onTimeChangeRef.current?.(video.currentTime);
    // Where to save: while a question is open, just before it.
    const savedTime = () => {
      const cue = openCueRef.current;
      return cue
        ? positionBeforeCue(cue, video.currentTime, video.duration)
        : video.currentTime;
    };
    // Cues: reached when playing, not seeking, and two time updates straddle
    // them. A seek, and the update after it, reach nothing.
    let seeking = false;
    let previousTime = video.currentTime;
    const askedCues = () =>
      (cuesRef.current ?? []).filter((cue) => cue.state === 'unanswered');
    const onSeeking = () => {
      seeking = true;
    };
    const onSeekEnd = () => {
      seeking = false;
      previousTime = video.currentTime;
    };
    const checkCues = () => {
      const current = video.currentTime;
      if (!seeking && !video.paused && onCueRef.current) {
        const reached = cuesReached(
          askedCues(),
          previousTime,
          current,
          video.duration,
        );
        if (reached.length > 0) {
          openCueRef.current = reached[0];
          onCueRef.current(
            reached.map((cue) => cue.id),
            'reached',
          );
        }
      }
      previousTime = current;
    };
    const onEnded = () => {
      const left = cuesAtEnd(askedCues(), video.duration);
      if (left.length > 0) {
        onCueRef.current?.(
          left.map((cue) => cue.id),
          'ended',
        );
      }
    };
    const tick = () => {
      reportTime();
      checkCues();
      if (!video.paused && onPositionChangeRef.current) {
        reporter.tick(savedTime(), video.duration);
      }
    };
    const onSeeked = () => {
      onSeekEnd();
      reportTime();
      flush();
    };
    const flush = () => {
      if (onPositionChangeRef.current) {
        reporter.flush(savedTime(), video.duration);
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
    video.addEventListener('seeking', onSeeking);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('ended', onEnded);
    video.addEventListener('play', dismissNotice);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      video.removeEventListener('loadedmetadata', resume);
      video.removeEventListener('timeupdate', tick);
      video.removeEventListener('pause', flush);
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('play', dismissNotice);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!transcript || !video) {
      return;
    }
    const update = () => setCurrentTime(video.currentTime);
    const onFullscreenChange = () =>
      setFullscreen(document.fullscreenElement !== null);
    video.addEventListener('timeupdate', update);
    video.addEventListener('seeked', update);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      video.removeEventListener('timeupdate', update);
      video.removeEventListener('seeked', update);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, [transcript]);

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

  const toggleTranscript = () => {
    const next = !transcriptOpen;
    setTranscriptOpen(next);
    savePreferences({ ...loadPreferences(), transcriptOpen: next });
  };

  const chooseCue = (cue: TranscriptCue) => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.currentTime = cue.start;
    setCurrentTime(cue.start);
    // Rejects when the browser blocks or interrupts playback.
    video.play()?.catch(() => {});
  };

  const player = (
    <VideoControls
      className={className}
      captions={captionFiles.loaded}
      captionNotice={captionFiles.notice}
      overlay={overlay}
      onOverlayDismiss={onOverlayDismiss}
      transcript={
        transcript
          ? {
              open: transcriptOpen,
              panelId,
              onToggle: toggleTranscript,
              onTrackChange: setTranscriptTrack,
            }
          : undefined
      }
    >
      <video
        ref={videoRef}
        data-slot="hls-video"
        autoPlay={autoPlay}
        controlsList="nodownload noremoteplayback"
        onContextMenu={(event) => event.preventDefault()}
        aria-label={title}
        className="size-full"
      >
        {captionFiles.loaded.map((caption) => (
          <CaptionTrack key={caption.trackId} caption={caption} />
        ))}
      </video>
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

  if (!transcript) {
    return player;
  }

  const hasTranscript = captionFiles.loaded.length > 0 || captionFiles.notice;
  const showPanel = transcriptOpen && hasTranscript && !fullscreen;
  return (
    <div
      data-slot="hls-video-layout"
      className={cn(
        'grid grid-cols-1 gap-3',
        showPanel && 'lg:grid-cols-[minmax(0,1fr)_20rem]',
      )}
    >
      {player}
      {showPanel && (
        <TranscriptPanel
          id={panelId}
          cues={transcriptTrack?.cues ?? []}
          activeIndex={activeCueIndex(transcriptTrack?.cues ?? [], currentTime)}
          languageLabel={transcriptTrack?.label ?? ''}
          status={!transcriptTrack && captionFiles.notice ? 'failed' : 'ready'}
          onChoose={chooseCue}
          className="max-h-[min(20rem,50vh)] lg:h-0 lg:max-h-none lg:min-h-full"
        />
      )}
    </div>
  );
}
