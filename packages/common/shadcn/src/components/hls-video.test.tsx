/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HlsVideo } from './hls-video';

const { hls } = vi.hoisted(() => ({
  hls: {
    isSupported: vi.fn(() => true),
    instances: [] as { config: any; loadSource: any; attachMedia: any }[],
  },
}));

vi.mock('hls.js', () => ({
  default: class {
    static isSupported = hls.isSupported;
    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    constructor(readonly config: any) {
      hls.instances.push(this);
    }
  },
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  hls.instances.length = 0;
});

// jsdom's media element has no playback: give it state and a play and pause
// that behave enough for the player's events.
const media = { currentTime: 0, duration: 120, paused: true };
beforeEach(() => {
  media.currentTime = 0;
  media.duration = 120;
  media.paused = true;
  for (const key of Object.keys(media) as (keyof typeof media)[]) {
    Object.defineProperty(HTMLMediaElement.prototype, key, {
      configurable: true,
      get: () => media[key],
      set: (value) => {
        (media as any)[key] = value;
      },
    });
  }
  HTMLMediaElement.prototype.play = vi.fn(function (this: HTMLMediaElement) {
    media.paused = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  HTMLMediaElement.prototype.pause = vi.fn(function (this: HTMLMediaElement) {
    media.paused = true;
    this.dispatchEvent(new Event('pause'));
  });
});

const URL = 'https://media.example.com/video/master.m3u8';

const video = (container: HTMLElement) =>
  container.querySelector('video') as HTMLVideoElement;

describe('HlsVideo', () => {
  it('plays natively where the browser can (Safari)', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue(
      'probably',
    );

    const { container } = render(
      <HlsVideo url={URL} withCredentials title="Lecture 1" />,
    );

    expect(video(container).src).toBe(URL);
    expect(video(container).getAttribute('aria-label')).toBe('Lecture 1');
    expect(hls.instances).toHaveLength(0);
  });

  it('plays through hls.js elsewhere, sending the signed cookies', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');

    const { container } = render(<HlsVideo url={URL} withCredentials />);

    const [instance] = hls.instances;
    expect(instance.loadSource).toHaveBeenCalledWith(URL);
    expect(instance.attachMedia).toHaveBeenCalledWith(video(container));
    const xhr = { withCredentials: false };
    instance.config.xhrSetup(xhr);
    expect(xhr.withCredentials).toBe(true);
  });

  it('sends no credentials for an unsigned URL (local dev, #137)', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');

    render(<HlsVideo url={URL} withCredentials={false} />);

    const [instance] = hls.instances;
    const xhr = { withCredentials: true };
    instance.config.xhrSetup(xhr);
    expect(xhr.withCredentials).toBe(false);
  });

  it('replaces the native controls with the custom bar', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');

    const { container, getByRole } = render(
      <HlsVideo url={URL} withCredentials />,
    );

    expect(video(container).hasAttribute('controls')).toBe(false);
    expect(video(container).getAttribute('controlslist')).toBe(
      'nodownload noremoteplayback',
    );
    expect(getByRole('button', { name: 'Playback speed' })).toBeTruthy();
  });

  it('puts the className on the player and blocks the context menu', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');

    const { container } = render(
      <HlsVideo url={URL} withCredentials className="aspect-video" />,
    );

    expect(
      container.querySelector('[data-slot="video-controls"]')?.className,
    ).toContain('aspect-video');
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
    });
    video(container).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  describe('resuming', () => {
    const renderResumed = (resumeAt: number, onPositionChange?: any) => {
      vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
      const result = render(
        <HlsVideo
          url={URL}
          withCredentials
          resumeAt={resumeAt}
          onPositionChange={onPositionChange}
        />,
      );
      act(() => {
        video(result.container).dispatchEvent(new Event('loadedmetadata'));
      });
      return result;
    };

    it('seeks to the saved position, stays paused and says so', () => {
      const { container, getByText, getByRole } = renderResumed(95);

      expect(media.currentTime).toBe(95);
      expect(media.paused).toBe(true);
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
      expect(getByText('Resumed at 1:35')).toBeTruthy();
      expect(getByRole('button', { name: 'Start over' })).toBeTruthy();
      expect(video(container).autoplay).toBe(false);
    });

    it('starts at the beginning, with no notice, without a saved position', () => {
      const { queryByText } = renderResumed(0);

      expect(media.currentTime).toBe(0);
      expect(queryByText(/Resumed at/)).toBeNull();
    });

    it('never seeks past the end', () => {
      media.duration = 60;
      renderResumed(95);

      expect(media.currentTime).toBeLessThan(60);
    });

    it('starts over from the notice', () => {
      const { getByRole, queryByText } = renderResumed(95);

      fireEvent.click(getByRole('button', { name: 'Start over' }));

      expect(media.currentTime).toBe(0);
      expect(queryByText(/Resumed at/)).toBeNull();
    });

    it('drops the notice after 8 seconds', () => {
      vi.useFakeTimers();
      const { queryByText } = renderResumed(95);

      act(() => {
        vi.advanceTimersByTime(7_999);
      });
      expect(queryByText(/Resumed at/)).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(queryByText(/Resumed at/)).toBeNull();
    });

    it('drops the notice on play', () => {
      const { container, queryByText } = renderResumed(95);

      act(() => {
        video(container).dispatchEvent(new Event('play'));
      });

      expect(queryByText(/Resumed at/)).toBeNull();
    });

    it('seeks when the metadata was already there', () => {
      vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
      Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
        configurable: true,
        get: () => 4,
      });

      render(<HlsVideo url={URL} withCredentials resumeAt={30} />);

      expect(media.currentTime).toBe(30);
      Reflect.deleteProperty(HTMLMediaElement.prototype, 'readyState');
    });
  });

  describe('reporting the position', () => {
    const setup = (onPositionChange = vi.fn(), resumeAt = 0) => {
      vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
      const result = render(
        <HlsVideo
          url={URL}
          withCredentials
          resumeAt={resumeAt}
          onPositionChange={onPositionChange}
        />,
      );
      const el = video(result.container);
      act(() => {
        el.dispatchEvent(new Event('loadedmetadata'));
      });
      return { el, onPositionChange };
    };
    const emit = (el: HTMLElement, type: string, at?: number) =>
      act(() => {
        if (at !== undefined) {
          media.currentTime = at;
        }
        el.dispatchEvent(new Event(type));
      });

    it('reports at most every 10 seconds while playing', () => {
      vi.useFakeTimers();
      const { el, onPositionChange } = setup();
      media.paused = false;

      emit(el, 'timeupdate', 4);
      expect(onPositionChange).not.toHaveBeenCalled();
      vi.advanceTimersByTime(10_000);
      emit(el, 'timeupdate', 14);
      expect(onPositionChange).toHaveBeenCalledTimes(1);
      expect(onPositionChange).toHaveBeenCalledWith({
        positionSeconds: 14,
        durationSeconds: 120,
      });
      vi.advanceTimersByTime(3_000);
      emit(el, 'timeupdate', 17);
      expect(onPositionChange).toHaveBeenCalledTimes(1);
    });

    it.each(['pause', 'seeked'])('reports on %s', (type) => {
      const { el, onPositionChange } = setup();

      emit(el, type, 40);

      expect(onPositionChange).toHaveBeenCalledWith({
        positionSeconds: 40,
        durationSeconds: 120,
      });
    });

    it('reports on pagehide', () => {
      const { onPositionChange } = setup();
      media.currentTime = 40;

      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });

      expect(onPositionChange).toHaveBeenCalledTimes(1);
    });

    it('reports when the page becomes hidden, not when visible', () => {
      const { onPositionChange } = setup();
      media.currentTime = 40;
      const state = vi.spyOn(document, 'visibilityState', 'get');

      state.mockReturnValue('visible');
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(onPositionChange).not.toHaveBeenCalled();

      state.mockReturnValue('hidden');
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(onPositionChange).toHaveBeenCalledTimes(1);
    });

    it('skips a report within a second of the last', () => {
      const { el, onPositionChange } = setup();

      emit(el, 'pause', 40);
      emit(el, 'pause', 40.4);

      expect(onPositionChange).toHaveBeenCalledTimes(1);
    });

    it('reports nothing for the position it resumed at', () => {
      const { el, onPositionChange } = setup(vi.fn(), 95);

      emit(el, 'seeked');
      emit(el, 'pause');

      expect(onPositionChange).not.toHaveBeenCalled();
    });

    it('stops listening when unmounted', () => {
      const { onPositionChange } = setup();
      cleanup();
      media.currentTime = 40;

      window.dispatchEvent(new Event('pagehide'));

      expect(onPositionChange).not.toHaveBeenCalled();
    });

    it('never reports without onPositionChange (the instructor preview)', () => {
      vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
      const { container } = render(<HlsVideo url={URL} withCredentials />);
      const el = video(container);

      expect(() => {
        emit(el, 'pause', 40);
        emit(el, 'seeked', 41);
        window.dispatchEvent(new Event('pagehide'));
      }).not.toThrow();
    });
  });
});
