/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type LoadedCaption, VideoControls } from './video-controls';

const STORAGE_KEY = 'discava-video-preferences';

// jsdom's media element does nothing: give it the state and methods the
// controls read and call.
let media: {
  paused: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
};
const play = vi.fn();
const pause = vi.fn();

beforeEach(() => {
  media = {
    paused: true,
    currentTime: 0,
    duration: 100,
    volume: 1,
    muted: false,
    playbackRate: 1,
  };
  play.mockReset().mockImplementation(function (this: HTMLMediaElement) {
    media.paused = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  pause.mockReset().mockImplementation(function (this: HTMLMediaElement) {
    media.paused = true;
    this.dispatchEvent(new Event('pause'));
  });
  for (const key of Object.keys(media) as (keyof typeof media)[]) {
    Object.defineProperty(HTMLMediaElement.prototype, key, {
      configurable: true,
      get: () => media[key],
      // Like a real element, tell listeners about the changes the controls
      // mirror.
      set(this: HTMLMediaElement, value) {
        (media as any)[key] = value;
        const event = (key === 'volume' || key === 'muted') && 'volumechange';
        if (event) {
          this.dispatchEvent(new Event(event));
        }
      },
    });
  }
  HTMLMediaElement.prototype.play = play;
  HTMLMediaElement.prototype.pause = pause;
  Object.defineProperty(document, 'fullscreenEnabled', {
    configurable: true,
    value: true,
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const setup = () => {
  const result = render(
    <VideoControls>
      <video data-testid="video" />
    </VideoControls>,
  );
  const video = screen.getByTestId('video') as HTMLVideoElement;
  const container = video.closest(
    '[data-slot="video-controls"]',
  ) as HTMLElement;
  return { ...result, video, container };
};

const press = (element: Element, key: string, init: object = {}) =>
  fireEvent.keyDown(element, { key, ...init });

describe('VideoControls shortcuts', () => {
  it('toggles play with Space and K', () => {
    const { container } = setup();
    press(container, ' ');
    expect(play).toHaveBeenCalledTimes(1);
    press(container, 'k');
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['j', -10, 50, 40],
    ['l', 10, 50, 60],
    ['ArrowLeft', -5, 50, 45],
    ['ArrowRight', 5, 50, 55],
  ])('%s skips %i s', (key, _seconds, from, to) => {
    const { container } = setup();
    media.currentTime = from;
    press(container, key);
    expect(media.currentTime).toBe(to);
  });

  it('keeps a skip inside the video', () => {
    const { container } = setup();
    media.currentTime = 3;
    press(container, 'j');
    expect(media.currentTime).toBe(0);
    media.currentTime = 98;
    press(container, 'l');
    expect(media.currentTime).toBe(100);
  });

  it('changes the volume 5% with Up and Down, within 0 to 1', () => {
    const { container } = setup();
    media.volume = 0.5;
    press(container, 'ArrowUp');
    expect(media.volume).toBeCloseTo(0.55);
    press(container, 'ArrowDown');
    press(container, 'ArrowDown');
    expect(media.volume).toBeCloseTo(0.45);
    media.volume = 0.98;
    press(container, 'ArrowUp');
    expect(media.volume).toBe(1);
    media.volume = 0.02;
    press(container, 'ArrowDown');
    expect(media.volume).toBe(0);
  });

  it('toggles mute with M', () => {
    const { container } = setup();
    press(container, 'm');
    expect(media.muted).toBe(true);
    press(container, 'm');
    expect(media.muted).toBe(false);
  });

  it('toggles fullscreen with F', () => {
    const { container } = setup();
    container.requestFullscreen = vi.fn().mockResolvedValue(undefined);
    document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
    press(container, 'f');
    expect(container.requestFullscreen).toHaveBeenCalled();
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: container,
    });
    press(container, 'f');
    expect(document.exitFullscreen).toHaveBeenCalled();
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    });
  });

  it('steps the speed with < and >', () => {
    const { container } = setup();
    press(container, '>');
    expect(media.playbackRate).toBe(1.25);
    press(container, '<');
    press(container, '<');
    expect(media.playbackRate).toBe(0.75);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string).speed).toBe(
      0.75,
    );
  });

  it('jumps to 0% to 90% with the number keys', () => {
    const { container } = setup();
    press(container, '5');
    expect(media.currentTime).toBe(50);
    press(container, '9');
    expect(media.currentTime).toBe(90);
    press(container, '0');
    expect(media.currentTime).toBe(0);
  });

  it('ignores shortcuts with Ctrl, Alt or Meta', () => {
    const { container } = setup();
    for (const mod of ['ctrlKey', 'altKey', 'metaKey']) {
      press(container, 'k', { [mod]: true });
    }
    expect(play).not.toHaveBeenCalled();
  });

  it('ignores shortcuts from an input', () => {
    const { container } = setup();
    const input = document.createElement('input');
    container.appendChild(input);
    press(input, 'k');
    press(input, 'm');
    expect(play).not.toHaveBeenCalled();
    expect(media.muted).toBe(false);
  });

  it('does not double-act on Space from a focused button', () => {
    setup();
    const button = screen.getByRole('button', { name: 'Mute' });
    press(button, ' ');
    expect(play).not.toHaveBeenCalled();
  });

  it('leaves the arrow keys to the focused slider', () => {
    setup();
    media.currentTime = 50;
    const slider = screen.getByRole('slider', { name: 'Seek' });
    press(slider, 'ArrowRight');
    expect(media.currentTime).not.toBe(55);
  });
});

describe('VideoControls controls', () => {
  it('plays and pauses from the button, exposing the state', async () => {
    setup();
    const button = screen.getByRole('button', { name: 'Play' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    expect(play).toHaveBeenCalled();
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(button);
    expect(pause).toHaveBeenCalled();
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('mutes from the button, exposing the state', async () => {
    setup();
    const button = screen.getByRole('button', { name: 'Mute' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    expect(media.muted).toBe(true);
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('chooses a speed from the menu, applying and saving it', async () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'Playback speed' });
    expect(trigger).toHaveTextContent('1x');
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitemradio', { name: '1.5x' }));
    expect(media.playbackRate).toBe(1.5);
    expect(
      screen.getByRole('button', { name: 'Playback speed' }),
    ).toHaveTextContent('1.5x');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string).speed).toBe(
      1.5,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Playback speed' }),
    );
    expect(screen.getByRole('menuitemradio', { name: '1.5x' })).toBeChecked();
  });

  it('shows the seek position as a slider with value text', () => {
    const { video } = setup();
    media.currentTime = 65;
    act(() => {
      video.dispatchEvent(new Event('timeupdate'));
    });
    const slider = screen.getByRole('slider', { name: 'Seek' });
    expect(slider).toHaveAttribute('aria-valuenow', '65');
    expect(slider).toHaveAttribute('aria-valuetext', '1:05 of 1:40');
  });

  it('shows the volume as a slider with value text', () => {
    setup();
    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveAttribute(
      'aria-valuetext',
      '100%',
    );
  });

  it('hides fullscreen where unsupported', () => {
    Object.defineProperty(document, 'fullscreenEnabled', {
      configurable: true,
      value: false,
    });
    setup();
    expect(screen.queryByRole('button', { name: 'Fullscreen' })).toBeNull();
  });

  it('shows fullscreen where supported', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeVisible();
  });
});

describe('VideoControls picture-in-picture', () => {
  const setPictureInPicture = (enabled: boolean, element: unknown = null) => {
    Object.defineProperty(document, 'pictureInPictureEnabled', {
      configurable: true,
      value: enabled,
    });
    Object.defineProperty(document, 'pictureInPictureElement', {
      configurable: true,
      value: element,
    });
  };

  afterEach(() => {
    // jsdom has neither property.
    setPictureInPicture(false);
  });

  it('is hidden where unsupported', () => {
    setPictureInPicture(false);
    setup();
    expect(
      screen.queryByRole('button', { name: 'Picture-in-picture' }),
    ).toBeNull();
  });

  it('is hidden when the video disables it', () => {
    setPictureInPicture(true);
    render(
      <VideoControls>
        <video disablePictureInPicture />
      </VideoControls>,
    );
    expect(
      screen.queryByRole('button', { name: 'Picture-in-picture' }),
    ).toBeNull();
  });

  it('enters picture-in-picture, exposing the state', async () => {
    setPictureInPicture(true);
    const { video } = setup();
    video.requestPictureInPicture = vi.fn().mockResolvedValue({});
    const button = screen.getByRole('button', { name: 'Picture-in-picture' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    expect(video.requestPictureInPicture).toHaveBeenCalled();
    setPictureInPicture(true, video);
    act(() => {
      video.dispatchEvent(new Event('enterpictureinpicture'));
    });
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('leaves picture-in-picture when already in it', async () => {
    setPictureInPicture(true);
    const { video } = setup();
    setPictureInPicture(true, video);
    document.exitPictureInPicture = vi.fn().mockResolvedValue(undefined);
    act(() => {
      video.dispatchEvent(new Event('enterpictureinpicture'));
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Picture-in-picture' }),
    );
    expect(document.exitPictureInPicture).toHaveBeenCalled();
    setPictureInPicture(true);
    act(() => {
      video.dispatchEvent(new Event('leavepictureinpicture'));
    });
    expect(
      screen.getByRole('button', { name: 'Picture-in-picture' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('is harmless when the browser refuses', async () => {
    setPictureInPicture(true);
    const { video } = setup();
    video.requestPictureInPicture = vi.fn().mockRejectedValue(new Error('no'));
    await userEvent.click(
      screen.getByRole('button', { name: 'Picture-in-picture' }),
    );
    expect(video.requestPictureInPicture).toHaveBeenCalled();
  });
});

describe('VideoControls preferences', () => {
  it('restores saved preferences on mount', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ speed: 2, volume: 0.3, muted: true }),
    );
    setup();
    expect(media.playbackRate).toBe(2);
    expect(media.volume).toBe(0.3);
    expect(media.muted).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Playback speed' }),
    ).toHaveTextContent('2x');
    expect(screen.getByRole('button', { name: 'Mute' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('saves volume and mute changes', () => {
    const { container } = setup();
    media.volume = 0.5;
    press(container, 'ArrowDown');
    press(container, 'm');
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEY) as string),
    ).toMatchObject({
      volume: expect.closeTo(0.45),
      muted: true,
    });
  });

  it('is harmless when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    const { container } = setup();
    expect(media.playbackRate).toBe(1);
    expect(() => press(container, '>')).not.toThrow();
    expect(media.playbackRate).toBe(1.25);
  });
});

describe('VideoControls visibility', () => {
  const bar = () => screen.getByRole('group', { name: 'Video controls' });

  it('is visible while paused', () => {
    setup();
    expect(bar()).toHaveAttribute('data-visible', 'true');
  });

  it('hides 3 seconds after activity while playing', () => {
    vi.useFakeTimers();
    const { container } = setup();
    press(container, 'k');
    expect(bar()).toHaveAttribute('data-visible', 'true');
    act(() => {
      vi.advanceTimersByTime(2900);
    });
    expect(bar()).toHaveAttribute('data-visible', 'true');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(bar()).toHaveAttribute('data-visible', 'false');
    fireEvent.pointerMove(container);
    expect(bar()).toHaveAttribute('data-visible', 'true');
  });

  it('stays visible while focus is within, and shows again when paused', () => {
    vi.useFakeTimers();
    const { container } = setup();
    press(container, 'k');
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(bar()).toHaveAttribute('data-visible', 'false');
    act(() => {
      screen.getByRole('button', { name: 'Mute' }).focus();
    });
    expect(bar()).toHaveAttribute('data-visible', 'true');
    act(() => {
      screen.getByRole('button', { name: 'Mute' }).blur();
    });
    expect(bar()).toHaveAttribute('data-visible', 'false');
    press(container, 'k');
    expect(bar()).toHaveAttribute('data-visible', 'true');
  });

  it('does not animate for reduced motion', () => {
    setup();
    expect(bar().className).toContain('motion-reduce:transition-none');
  });
});

describe('VideoControls captions', () => {
  const CAPTIONS: LoadedCaption[] = [
    {
      trackId: 'a',
      language: 'es-ES',
      label: 'Spanish',
      isDefault: false,
      src: 'blob:es',
    },
    {
      trackId: 'b',
      language: 'en-US',
      label: 'English',
      isDefault: true,
      src: 'blob:en',
    },
  ];

  // jsdom's <track> has no TextTrack: give each element one that records its
  // mode, as a browser's would.
  beforeEach(() => {
    Object.defineProperty(HTMLTrackElement.prototype, 'track', {
      configurable: true,
      get(this: HTMLTrackElement) {
        const self = this as any;
        self.__track ??= { mode: 'disabled' };
        return self.__track;
      },
    });
  });
  afterEach(() => {
    // biome-ignore lint/performance/noDelete: restoring jsdom's own state
    delete (HTMLTrackElement.prototype as any).track;
  });

  const setupCaptions = (
    captions: LoadedCaption[] | undefined = CAPTIONS,
    captionNotice?: string,
  ) => {
    const result = render(
      <VideoControls captions={captions} captionNotice={captionNotice}>
        <video data-testid="video">
          {captions.map((c) => (
            <track
              key={c.trackId}
              data-track-id={c.trackId}
              kind="captions"
              srcLang={c.language}
              label={c.label}
              src={c.src}
            />
          ))}
        </video>
      </VideoControls>,
    );
    const video = screen.getByTestId('video') as HTMLVideoElement;
    const container = video.closest(
      '[data-slot="video-controls"]',
    ) as HTMLElement;
    const modeOf = (trackId: string) =>
      (
        video.querySelector(
          `track[data-track-id="${trackId}"]`,
        ) as HTMLTrackElement
      ).track.mode;
    return { ...result, video, container, modeOf };
  };

  const captionsButton = () =>
    screen.getByRole('button', { name: /^Captions/ });
  const savedPreferences = () =>
    JSON.parse(localStorage.getItem(STORAGE_KEY) as string);

  it('has no captions control when there are none', () => {
    setup();
    expect(screen.queryByRole('button', { name: /^Captions/ })).toBeNull();
    cleanup();
    setupCaptions([]);
    expect(screen.queryByRole('button', { name: /^Captions/ })).toBeNull();
  });

  it('starts with captions off, and lists Off plus each track with the default marked', async () => {
    const { modeOf } = setupCaptions();
    expect(captionsButton()).toHaveAccessibleName('Captions: off');
    expect(modeOf('a')).toBe('disabled');
    expect(modeOf('b')).toBe('disabled');
    await userEvent.click(captionsButton());
    expect(screen.getByRole('menuitemradio', { name: 'Off' })).toBeChecked();
    expect(
      screen.getByRole('menuitemradio', { name: 'Spanish' }),
    ).toBeVisible();
    expect(
      screen.getByRole('menuitemradio', { name: 'English (default)' }),
    ).toBeVisible();
  });

  it('shows the chosen track, hides the rest, and remembers the choice', async () => {
    const { modeOf } = setupCaptions();
    await userEvent.click(captionsButton());
    await userEvent.click(
      screen.getByRole('menuitemradio', { name: 'Spanish' }),
    );
    expect(modeOf('a')).toBe('showing');
    expect(modeOf('b')).toBe('disabled');
    expect(captionsButton()).toHaveAccessibleName('Captions: Spanish');
    expect(savedPreferences()).toMatchObject({
      captionsOn: true,
      captionLanguage: 'es-ES',
    });
    await userEvent.click(captionsButton());
    expect(
      screen.getByRole('menuitemradio', { name: 'Spanish' }),
    ).toBeChecked();
  });

  it('turns captions off from the menu, keeping the last language', async () => {
    const { modeOf } = setupCaptions();
    await userEvent.click(captionsButton());
    await userEvent.click(
      screen.getByRole('menuitemradio', { name: 'Spanish' }),
    );
    await userEvent.click(captionsButton());
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Off' }));
    expect(modeOf('a')).toBe('disabled');
    expect(savedPreferences()).toMatchObject({
      captionsOn: false,
      captionLanguage: 'es-ES',
    });
  });

  it('toggles the last chosen track with C', () => {
    const { container, modeOf } = setupCaptions();
    // Nothing chosen yet: the default track.
    press(container, 'c');
    expect(modeOf('b')).toBe('showing');
    expect(savedPreferences()).toMatchObject({
      captionsOn: true,
      captionLanguage: 'en-US',
    });
    press(container, 'c');
    expect(modeOf('b')).toBe('disabled');
    expect(savedPreferences().captionsOn).toBe(false);
    press(container, 'C');
    expect(modeOf('b')).toBe('showing');
  });

  it('toggles back to the track last chosen from the menu with C', async () => {
    const { container, modeOf } = setupCaptions();
    await userEvent.click(captionsButton());
    await userEvent.click(
      screen.getByRole('menuitemradio', { name: 'Spanish' }),
    );
    press(container, 'c');
    expect(modeOf('a')).toBe('disabled');
    press(container, 'c');
    expect(modeOf('a')).toBe('showing');
  });

  it('applies the remembered on/off choice and language on mount', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ captionsOn: true, captionLanguage: 'es-ES' }),
    );
    const { modeOf } = setupCaptions();
    expect(modeOf('a')).toBe('showing');
    expect(modeOf('b')).toBe('disabled');
  });

  it('falls back to the default track when the remembered language is not offered', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ captionsOn: true, captionLanguage: 'ja-JP' }),
    );
    const { modeOf } = setupCaptions();
    expect(modeOf('b')).toBe('showing');
  });

  it('keeps captions off when the remembered choice is off', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ captionsOn: false, captionLanguage: 'es-ES' }),
    );
    const { modeOf } = setupCaptions();
    expect(modeOf('a')).toBe('disabled');
  });

  it('shows the notice for a track that failed to load in the menu', async () => {
    setupCaptions([CAPTIONS[1]], 'Spanish captions could not be loaded.');
    await userEvent.click(captionsButton());
    expect(
      screen.getByText('Spanish captions could not be loaded.'),
    ).toBeVisible();
    expect(screen.getByRole('menuitemradio', { name: 'Off' })).toBeVisible();
  });

  it('ignores C when there are no captions', () => {
    const { container } = setup();
    press(container, 'c');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('is harmless when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    const { container, modeOf } = setupCaptions();
    press(container, 'c');
    expect(modeOf('b')).toBe('showing');
  });
});
