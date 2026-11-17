/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPositionReporter,
  DEFAULT_PREFERENCES,
  keyToAction,
  loadPreferences,
  SPEEDS,
  savePreferences,
  stepSpeed,
} from './video-player';

const key = (
  k: string,
  init: Partial<Parameters<typeof keyToAction>[0]> = {},
) => keyToAction({ key: k, target: null, ...init });

describe('stepSpeed', () => {
  it('steps through SPEEDS', () => {
    expect(stepSpeed(1, 1)).toBe(1.25);
    expect(stepSpeed(1, -1)).toBe(0.75);
  });

  it('clamps at the ends', () => {
    expect(stepSpeed(SPEEDS[0], -1)).toBe(0.5);
    expect(stepSpeed(2, 1)).toBe(2);
  });

  it('moves from a speed outside SPEEDS to the next one in that direction', () => {
    expect(stepSpeed(1.1, 1)).toBe(1.25);
    expect(stepSpeed(1.1, -1)).toBe(1);
  });
});

describe('keyToAction', () => {
  it.each([
    [' ', { type: 'togglePlay' }],
    ['k', { type: 'togglePlay' }],
    ['K', { type: 'togglePlay' }],
    ['j', { type: 'skip', seconds: -10 }],
    ['l', { type: 'skip', seconds: 10 }],
    ['ArrowLeft', { type: 'skip', seconds: -5 }],
    ['ArrowRight', { type: 'skip', seconds: 5 }],
    ['ArrowUp', { type: 'volume', delta: 0.05 }],
    ['ArrowDown', { type: 'volume', delta: -0.05 }],
    ['m', { type: 'toggleMute' }],
    ['c', { type: 'toggleCaptions' }],
    ['f', { type: 'toggleFullscreen' }],
    ['<', { type: 'speed', direction: -1 }],
    ['>', { type: 'speed', direction: 1 }],
    ['0', { type: 'seekFraction', fraction: 0 }],
    ['5', { type: 'seekFraction', fraction: 0.5 }],
    ['9', { type: 'seekFraction', fraction: 0.9 }],
  ])('maps %j', (k, action) => {
    expect(key(k)).toEqual(action);
  });

  it('returns undefined for other keys', () => {
    expect(key('x')).toBeUndefined();
    expect(key('Enter')).toBeUndefined();
  });

  it.each(['ctrlKey', 'altKey', 'metaKey'] as const)('ignores %s', (mod) => {
    expect(key('k', { [mod]: true })).toBeUndefined();
  });

  it.each([
    ['input', () => document.createElement('input')],
    ['textarea', () => document.createElement('textarea')],
    ['select', () => document.createElement('select')],
    [
      'contenteditable',
      () => {
        const el = document.createElement('div');
        el.setAttribute('contenteditable', 'true');
        return el;
      },
    ],
  ])('ignores events from a %s', (_name, make) => {
    expect(key('k', { target: make() })).toBeUndefined();
  });

  it('handles events from other elements', () => {
    expect(key('k', { target: document.createElement('div') })).toEqual({
      type: 'togglePlay',
    });
  });
});

describe('preferences', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('defaults to 1x, full volume, unmuted, captions off', () => {
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
    expect(DEFAULT_PREFERENCES).toEqual({
      speed: 1,
      volume: 1,
      muted: false,
      captionsOn: false,
      captionLanguage: undefined,
    });
  });

  it('round-trips saved preferences', () => {
    const prefs = {
      speed: 1.5,
      volume: 0.4,
      muted: true,
      captionsOn: true,
      captionLanguage: 'en',
    };
    savePreferences(prefs);
    expect(loadPreferences()).toEqual(prefs);
  });

  it.each([
    ['a speed not in SPEEDS', { speed: 3 }, { speed: 1 }],
    ['a string speed', { speed: '2' }, { speed: 1 }],
    ['a volume above 1', { volume: 2 }, { volume: 1 }],
    ['a negative volume', { volume: -0.1 }, { volume: 1 }],
    ['a string volume', { volume: 'loud' }, { volume: 1 }],
    ['a non-boolean muted', { muted: 'yes' }, { muted: false }],
    ['a non-boolean captionsOn', { captionsOn: 1 }, { captionsOn: false }],
    [
      'a non-string language',
      { captionLanguage: 5 },
      { captionLanguage: undefined },
    ],
  ])('discards %s', (_name, stored, expected) => {
    localStorage.setItem(
      'discava-video-preferences',
      JSON.stringify({ ...DEFAULT_PREFERENCES, ...stored }),
    );
    expect(loadPreferences()).toEqual({ ...DEFAULT_PREFERENCES, ...expected });
  });

  it('keeps valid fields when others are invalid', () => {
    localStorage.setItem(
      'discava-video-preferences',
      JSON.stringify({ speed: 2, volume: 9 }),
    );
    expect(loadPreferences()).toEqual({
      ...DEFAULT_PREFERENCES,
      speed: 2,
      volume: 1,
    });
  });

  it.each(['not json', 'null', '[1]', '"x"'])('survives stored %s', (raw) => {
    localStorage.setItem('discava-video-preferences', raw);
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('is silent when storage throws on get', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('is silent when storage throws on set', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(() => savePreferences(DEFAULT_PREFERENCES)).not.toThrow();
  });
});

describe('createPositionReporter', () => {
  let clock: number;
  let report: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    clock = 0;
    report = vi.fn();
  });
  const make = (initialPosition?: number) =>
    createPositionReporter(report, { now: () => clock, initialPosition });

  it('reports a tick at most every 10 seconds', () => {
    const reporter = make();
    reporter.tick(5, 100);
    expect(report).not.toHaveBeenCalled();

    clock = 10_000;
    reporter.tick(15, 100);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenLastCalledWith({
      positionSeconds: 15,
      durationSeconds: 100,
    });

    clock = 19_000;
    reporter.tick(24, 100);
    expect(report).toHaveBeenCalledTimes(1);

    clock = 20_000;
    reporter.tick(25, 100);
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('reports on flush (pause, seek end, page hide) without waiting', () => {
    const reporter = make();
    reporter.flush(30, 100);
    expect(report).toHaveBeenCalledWith({
      positionSeconds: 30,
      durationSeconds: 100,
    });
  });

  it('skips a report whose position moved under a second', () => {
    const reporter = make();
    reporter.flush(30, 100);
    reporter.flush(30.5, 100);
    reporter.flush(29.2, 100);
    expect(report).toHaveBeenCalledTimes(1);

    reporter.flush(31, 100);
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('measures from where playback resumed', () => {
    const reporter = make(60);
    reporter.flush(60, 100);
    expect(report).not.toHaveBeenCalled();
  });

  it('does not report before the duration is known', () => {
    const reporter = make();
    reporter.flush(30, Number.NaN);
    reporter.flush(30, 0);
    reporter.flush(30, Number.POSITIVE_INFINITY);
    expect(report).not.toHaveBeenCalled();
  });

  it('does not report a negative or non-finite position', () => {
    const reporter = make();
    reporter.flush(-1, 100);
    reporter.flush(Number.NaN, 100);
    expect(report).not.toHaveBeenCalled();
  });
});
