/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
'use client';

import {
  keyToAction,
  loadPreferences,
  type PlayerAction,
  type PlayerPreferences,
  SPEEDS,
  savePreferences,
  stepSpeed,
} from '@discava/common-web-utils/video-player';
import { cn } from 'cn';
import {
  MaximizeIcon,
  MinimizeIcon,
  PauseIcon,
  PictureInPicture2Icon,
  PlayIcon,
  SubtitlesIcon,
  Volume2Icon,
  VolumeXIcon,
} from 'lucide-react';
import * as React from 'react';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Slider } from './ui/slider';

// How long the bar stays after the last pointer or key activity while playing.
const IDLE_HIDE_MS = 3000;

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** A caption track whose file has loaded, ready to attach as a `<track>`. */
export interface LoadedCaption {
  trackId: string;
  // BCP 47 tag, e.g. en-US.
  language: string;
  label: string;
  isDefault: boolean;
  // A blob URL of the file.
  src: string;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * An accessible control bar and keyboard shortcuts for the `<video>` it
 * wraps, replacing the browser's native controls: play/pause, seek, volume,
 * mute, speed, captions, picture-in-picture and fullscreen. Speed, volume,
 * mute and the captions choice are remembered across videos (see
 * `@discava/common-web-utils/video-player`).
 *
 * `captions` are the tracks already loaded, with a `<track>` for each among
 * the children (with its id as `data-track-id`); this shows one at a time by
 * setting the tracks' modes. The control is absent without any (or a
 * `captionNotice`, about a track that failed to load, which it shows in the
 * menu).
 *
 * The container takes focus and handles the shortcuts, so they work while
 * focus is anywhere in the player. Keys the focused control already uses
 * (Space on a button, arrows on a slider) are left to it.
 */
export function VideoControls({
  children,
  className,
  captions = [],
  captionNotice,
}: {
  // The `<video>` element to control.
  children: React.ReactNode;
  className?: string;
  captions?: LoadedCaption[];
  captionNotice?: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [paused, setPaused] = React.useState(true);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [volume, setVolume] = React.useState(1);
  const [muted, setMuted] = React.useState(false);
  const [speed, setSpeed] = React.useState(1);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [pipAvailable, setPipAvailable] = React.useState(false);
  const [pip, setPip] = React.useState(false);
  const [focusWithin, setFocusWithin] = React.useState(false);
  const [active, setActive] = React.useState(false);
  const hideTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  // What the viewer chose before this video: read once. Until they choose
  // here, it decides whether captions show and which track.
  const [rememberedCaptions] = React.useState(() => {
    const { captionsOn, captionLanguage } = loadPreferences();
    return { on: captionsOn, language: captionLanguage };
  });
  const [captionChoice, setCaptionChoice] = React.useState<{
    on: boolean;
    trackId: string | undefined;
  }>();

  const getVideo = () =>
    containerRef.current?.querySelector('video') ?? undefined;

  // The preferences are all kept together, so a change to one rewrites the
  // others as they are now (and the caption ones as other code saved them).
  const savePreference = (patch: Partial<PlayerPreferences>) =>
    savePreferences({ ...loadPreferences(), ...patch });

  React.useEffect(() => {
    const video = getVideo();
    if (!video) {
      return;
    }

    const apply = (preferences: PlayerPreferences) => {
      video.playbackRate = preferences.speed;
      video.volume = preferences.volume;
      video.muted = preferences.muted;
    };
    const sync = () => {
      setPaused(video.paused);
      setCurrentTime(video.currentTime);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      setVolume(video.volume);
      setMuted(video.muted);
      setSpeed(video.playbackRate);
    };
    // A new source (hls.js attaching, or src changing) can reset the rate.
    const reapply = () => {
      apply(loadPreferences());
      sync();
    };

    reapply();
    setPipAvailable(
      document.pictureInPictureEnabled === true &&
        !video.disablePictureInPicture &&
        !video.hasAttribute('disablepictureinpicture'),
    );
    const onPipChange = () =>
      setPip(document.pictureInPictureElement === video);
    video.addEventListener('enterpictureinpicture', onPipChange);
    video.addEventListener('leavepictureinpicture', onPipChange);
    const events = [
      'play',
      'pause',
      'ended',
      'timeupdate',
      'seeked',
      'durationchange',
      'volumechange',
      'ratechange',
    ];
    for (const event of events) {
      video.addEventListener(event, sync);
    }
    video.addEventListener('loadedmetadata', reapply);
    return () => {
      video.removeEventListener('enterpictureinpicture', onPipChange);
      video.removeEventListener('leavepictureinpicture', onPipChange);
      for (const event of events) {
        video.removeEventListener(event, sync);
      }
      video.removeEventListener('loadedmetadata', reapply);
    };
  }, []);

  React.useEffect(() => {
    const onChange = () =>
      setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  React.useEffect(() => () => clearTimeout(hideTimer.current), []);

  // The track a toggle brings back: the last one chosen, else the remembered
  // language, else the default, else the first.
  const lastTrack =
    captions.find((c) => c.trackId === captionChoice?.trackId) ??
    captions.find((c) => c.language === rememberedCaptions.language) ??
    captions.find((c) => c.isDefault) ??
    captions[0];
  const captionsOn = captionChoice?.on ?? rememberedCaptions.on;
  const shownTrack = captionsOn ? lastTrack : undefined;
  const shownTrackId = shownTrack?.trackId;

  // Show the chosen track and hide the others, whenever either changes
  // (tracks arrive one by one as they load).
  React.useEffect(() => {
    const video = getVideo();
    if (!video) {
      return;
    }
    for (const element of video.querySelectorAll('track')) {
      const track = (element as HTMLTrackElement).track;
      if (track) {
        track.mode =
          element.getAttribute('data-track-id') === shownTrackId
            ? 'showing'
            : 'disabled';
      }
    }
  }, [captions, shownTrackId]);

  const showBriefly = () => {
    setActive(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setActive(false), IDLE_HIDE_MS);
  };

  const togglePlay = () => {
    const video = getVideo();
    if (!video) {
      return;
    }
    if (video.paused) {
      // Rejects when the browser blocks or interrupts playback: the paused
      // state then simply stays as the element reports it.
      video.play()?.catch(() => {});
    } else {
      video.pause();
    }
  };

  const seekTo = (seconds: number) => {
    const video = getVideo();
    if (video) {
      video.currentTime = clamp(seconds, 0, duration || video.duration || 0);
    }
  };

  const setVideoVolume = (next: number) => {
    const video = getVideo();
    if (!video) {
      return;
    }
    const value = clamp(next, 0, 1);
    video.volume = value;
    video.muted = value === 0;
    savePreference({ volume: value, muted: video.muted });
  };

  const toggleMute = () => {
    const video = getVideo();
    if (!video) {
      return;
    }
    video.muted = !video.muted;
    savePreference({ muted: video.muted });
  };

  const chooseSpeed = (next: number) => {
    const video = getVideo();
    if (video) {
      video.playbackRate = next;
    }
    setSpeed(next);
    savePreference({ speed: next });
  };

  const chooseCaption = (trackId: string | undefined) => {
    const track = captions.find((c) => c.trackId === trackId);
    if (track) {
      setCaptionChoice({ on: true, trackId: track.trackId });
      savePreference({ captionsOn: true, captionLanguage: track.language });
    } else {
      setCaptionChoice({ on: false, trackId: lastTrack?.trackId });
      savePreference({ captionsOn: false });
    }
  };

  const toggleCaptions = () => {
    if (captions.length === 0) {
      return;
    }
    chooseCaption(shownTrack ? undefined : lastTrack?.trackId);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.()?.catch(() => {});
    } else {
      containerRef.current?.requestFullscreen?.()?.catch(() => {});
    }
  };

  const togglePictureInPicture = () => {
    const video = getVideo();
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture?.()?.catch(() => {});
    } else {
      video?.requestPictureInPicture?.()?.catch(() => {});
    }
  };

  const run = (action: PlayerAction) => {
    const video = getVideo();
    if (!video) {
      return;
    }
    switch (action.type) {
      case 'togglePlay':
        return togglePlay();
      case 'skip':
        return seekTo(video.currentTime + action.seconds);
      case 'volume':
        return setVideoVolume(video.volume + action.delta);
      case 'toggleMute':
        return toggleMute();
      case 'toggleFullscreen':
        return toggleFullscreen();
      case 'speed':
        return chooseSpeed(stepSpeed(video.playbackRate, action.direction));
      case 'seekFraction':
        return seekTo((duration || video.duration || 0) * action.fraction);
      case 'toggleCaptions':
        return toggleCaptions();
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    showBriefly();
    // Menus render in a portal but their events still bubble through React.
    if (!event.currentTarget.contains(event.target as Node)) {
      return;
    }
    const target = event.target as HTMLElement;
    // A focused control keeps the keys it already handles: Space activates a
    // button, arrows move a slider.
    if (target.closest('button, [role="menuitemradio"]') && event.key === ' ') {
      return;
    }
    if (target.closest('[role="slider"]') && event.key.startsWith('Arrow')) {
      return;
    }
    const action = keyToAction(event);
    if (action) {
      event.preventDefault();
      run(action);
    }
  };

  const visible = paused || focusWithin || active;
  const total = formatTime(duration);

  return (
    <div
      ref={containerRef}
      data-slot="video-controls"
      role="group"
      aria-label="Video player"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerMove={showBriefly}
      onFocus={() => setFocusWithin(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setFocusWithin(false);
        }
      }}
      className={cn(
        'group/video relative overflow-hidden bg-black outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
    >
      {children}
      <div
        role="group"
        aria-label="Video controls"
        data-visible={visible}
        className={cn(
          'absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/80 to-transparent p-2 text-white transition-opacity motion-reduce:transition-none',
          !visible && 'pointer-events-none opacity-0',
        )}
      >
        <Slider
          thumbLabel="Seek"
          thumbValueText={`${formatTime(currentTime)} of ${total}`}
          min={0}
          max={Math.max(duration, 1)}
          step={1}
          value={[Math.min(currentTime, Math.max(duration, 1))]}
          disabled={!duration}
          onValueChange={([value]) => seekTo(value)}
        />
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Play"
            aria-pressed={!paused}
            onClick={togglePlay}
            className="hover:bg-white/20 hover:text-white"
          >
            {paused ? <PlayIcon /> : <PauseIcon />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Mute"
            aria-pressed={muted}
            onClick={toggleMute}
            className="hover:bg-white/20 hover:text-white"
          >
            {muted || volume === 0 ? <VolumeXIcon /> : <Volume2Icon />}
          </Button>
          <Slider
            className="w-20"
            thumbLabel="Volume"
            thumbValueText={`${Math.round((muted ? 0 : volume) * 100)}%`}
            min={0}
            max={100}
            step={5}
            value={[Math.round((muted ? 0 : volume) * 100)]}
            onValueChange={([value]) => setVideoVolume(value / 100)}
          />
          <span className="ml-2 text-xs tabular-nums">
            {formatTime(currentTime)} / {total}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Playback speed"
                  className="hover:bg-white/20 hover:text-white"
                >
                  {speed}x
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                  value={String(speed)}
                  onValueChange={(value) => chooseSpeed(Number(value))}
                >
                  {SPEEDS.map((option) => (
                    <DropdownMenuRadioItem key={option} value={String(option)}>
                      {option}x
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {(captions.length > 0 || captionNotice) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Captions: ${shownTrack ? shownTrack.label : 'off'}`}
                    className="hover:bg-white/20 hover:text-white"
                  >
                    <SubtitlesIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuRadioGroup
                    value={shownTrackId ?? 'off'}
                    onValueChange={(value) =>
                      chooseCaption(value === 'off' ? undefined : value)
                    }
                  >
                    <DropdownMenuRadioItem value="off">
                      Off
                    </DropdownMenuRadioItem>
                    {captions.map((caption) => (
                      <DropdownMenuRadioItem
                        key={caption.trackId}
                        value={caption.trackId}
                      >
                        {caption.label}
                        {caption.isDefault ? ' (default)' : ''}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  {captionNotice && (
                    <p
                      role="status"
                      className="px-2 py-1.5 text-xs text-muted-foreground"
                    >
                      {captionNotice}
                    </p>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {pipAvailable && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Picture-in-picture"
                aria-pressed={pip}
                onClick={togglePictureInPicture}
                className="hover:bg-white/20 hover:text-white"
              >
                <PictureInPicture2Icon />
              </Button>
            )}
            {typeof document !== 'undefined' && document.fullscreenEnabled && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Fullscreen"
                aria-pressed={fullscreen}
                onClick={toggleFullscreen}
                className="hover:bg-white/20 hover:text-white"
              >
                {fullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
