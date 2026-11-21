/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/** Playback speeds the player offers, slowest first. */
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** The next slower (-1) or faster (+1) speed, clamped at the ends. */
export function stepSpeed(current: number, direction: 1 | -1): number {
  if (direction === 1) {
    return SPEEDS.find((speed) => speed > current) ?? SPEEDS[SPEEDS.length - 1];
  }
  return [...SPEEDS].reverse().find((speed) => speed < current) ?? SPEEDS[0];
}

export type PlayerAction =
  | { type: 'togglePlay' }
  | { type: 'skip'; seconds: number }
  | { type: 'volume'; delta: number }
  | { type: 'toggleMute' }
  | { type: 'toggleCaptions' }
  | { type: 'toggleFullscreen' }
  | { type: 'speed'; direction: 1 | -1 }
  | { type: 'seekFraction'; fraction: number };

const VOLUME_STEP = 0.05;

/**
 * What a key press does to the player, or undefined when the player should
 * leave it alone: with Ctrl, Alt or Meta (browser and OS shortcuts), or from
 * a field the user is typing in.
 */
export function keyToAction(event: {
  key: string;
  target: EventTarget | null;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}): PlayerAction | undefined {
  if (event.ctrlKey || event.altKey || event.metaKey) {
    return undefined;
  }
  if (isTypingTarget(event.target)) {
    return undefined;
  }

  switch (event.key) {
    case ' ':
    case 'k':
    case 'K':
      return { type: 'togglePlay' };
    case 'j':
    case 'J':
      return { type: 'skip', seconds: -10 };
    case 'l':
    case 'L':
      return { type: 'skip', seconds: 10 };
    case 'ArrowLeft':
      return { type: 'skip', seconds: -5 };
    case 'ArrowRight':
      return { type: 'skip', seconds: 5 };
    case 'ArrowUp':
      return { type: 'volume', delta: VOLUME_STEP };
    case 'ArrowDown':
      return { type: 'volume', delta: -VOLUME_STEP };
    case 'm':
    case 'M':
      return { type: 'toggleMute' };
    case 'c':
    case 'C':
      return { type: 'toggleCaptions' };
    case 'f':
    case 'F':
      return { type: 'toggleFullscreen' };
    case '<':
      return { type: 'speed', direction: -1 };
    case '>':
      return { type: 'speed', direction: 1 };
  }

  if (/^[0-9]$/.test(event.key)) {
    return { type: 'seekFraction', fraction: Number(event.key) / 10 };
  }
  return undefined;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !('tagName' in target)) {
    return false;
  }
  const element = target as HTMLElement;
  return (
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) ||
    element.isContentEditable === true ||
    ['', 'true', 'plaintext-only'].includes(
      element.getAttribute('contenteditable') ?? 'false',
    )
  );
}

export interface PlayerPreferences {
  speed: number;
  /** 0 to 1. */
  volume: number;
  muted: boolean;
  captionsOn: boolean;
  /** The last caption track chosen. */
  captionLanguage: string | undefined;
  /** Whether the transcript panel is open. */
  transcriptOpen: boolean;
}

export const DEFAULT_PREFERENCES: PlayerPreferences = {
  speed: 1,
  volume: 1,
  muted: false,
  captionsOn: false,
  captionLanguage: undefined,
  transcriptOpen: false,
};

const STORAGE_KEY = 'discava-video-preferences';

/**
 * The viewer's saved player preferences. Each stored field is validated on
 * its own; anything missing, of the wrong type or out of range is its
 * default. Storage that is unavailable or corrupted gives all defaults.
 */
export function loadPreferences(): PlayerPreferences {
  let stored: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    stored = raw === null ? undefined : JSON.parse(raw);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return { ...DEFAULT_PREFERENCES };
  }
  const { speed, volume, muted, captionsOn, captionLanguage, transcriptOpen } =
    stored as Record<string, unknown>;
  return {
    speed:
      typeof speed === 'number' && (SPEEDS as readonly number[]).includes(speed)
        ? speed
        : DEFAULT_PREFERENCES.speed,
    volume:
      typeof volume === 'number' && volume >= 0 && volume <= 1
        ? volume
        : DEFAULT_PREFERENCES.volume,
    muted: typeof muted === 'boolean' ? muted : DEFAULT_PREFERENCES.muted,
    captionsOn:
      typeof captionsOn === 'boolean'
        ? captionsOn
        : DEFAULT_PREFERENCES.captionsOn,
    captionLanguage:
      typeof captionLanguage === 'string' ? captionLanguage : undefined,
    transcriptOpen:
      typeof transcriptOpen === 'boolean'
        ? transcriptOpen
        : DEFAULT_PREFERENCES.transcriptOpen,
  };
}

/** Saves the preferences; silent when storage is unavailable or full. */
export function savePreferences(preferences: PlayerPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences are a convenience: the player works without them.
  }
}

export interface PlayerPosition {
  positionSeconds: number;
  durationSeconds: number;
}

/** How often a playing video reports its position. */
export const POSITION_REPORT_INTERVAL_MS = 10_000;

// A report for a position this close to the last one adds nothing.
const MIN_POSITION_MOVE_SECONDS = 1;

/**
 * Decides when a player's position is worth reporting (to be saved for
 * resuming). `tick` is for the steady stream of time updates while playing:
 * it reports at most every 10 seconds. `flush` is for moments the viewer may
 * be leaving (pause, the end of a seek, the page hiding): it reports now.
 * Both skip a position within a second of the last one reported, and a
 * position or duration that isn't usable yet. `initialPosition` is where
 * playback starts, so resuming reports nothing until the viewer moves on.
 */
export function createPositionReporter(
  report: (position: PlayerPosition) => void,
  options: { initialPosition?: number; now?: () => number } = {},
) {
  const now = options.now ?? Date.now;
  let lastPosition = options.initialPosition ?? 0;
  let lastAt = now();

  const send = (positionSeconds: number, durationSeconds: number) => {
    if (
      !Number.isFinite(positionSeconds) ||
      positionSeconds < 0 ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      Math.abs(positionSeconds - lastPosition) < MIN_POSITION_MOVE_SECONDS
    ) {
      return;
    }
    lastPosition = positionSeconds;
    lastAt = now();
    report({ positionSeconds, durationSeconds });
  };

  return {
    tick(positionSeconds: number, durationSeconds: number) {
      if (now() - lastAt >= POSITION_REPORT_INTERVAL_MS) {
        send(positionSeconds, durationSeconds);
      }
    },
    flush: send,
  };
}
