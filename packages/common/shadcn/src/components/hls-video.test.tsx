/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

    describe('startAt', () => {
      const renderStarted = (
        startAt: number,
        onPositionChange?: any,
        resumeAt = 30,
      ) => {
        vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
        const result = render(
          <HlsVideo
            url={URL}
            withCredentials
            resumeAt={resumeAt}
            startAt={startAt}
            onPositionChange={onPositionChange}
          />,
        );
        act(() => {
          video(result.container).dispatchEvent(new Event('loadedmetadata'));
        });
        return result;
      };

      beforeEach(() => {
        media.duration = 1_000;
      });

      it('seeks to startAt in place of resumeAt and stays paused', () => {
        renderStarted(760);

        expect(media.currentTime).toBe(760);
        expect(media.paused).toBe(true);
      });

      it('says "Starting at" with no "Start over"', () => {
        const { getByText, queryByRole, queryByText } = renderStarted(760);

        expect(getByText('Starting at 12:40')).toBeTruthy();
        expect(queryByRole('button', { name: 'Start over' })).toBeNull();
        expect(queryByText(/Resumed at/)).toBeNull();
      });

      it('saves nothing for the seek', () => {
        const onPositionChange = vi.fn();
        renderStarted(760, onPositionChange);

        expect(onPositionChange).not.toHaveBeenCalled();
      });

      it('clamps a start past the duration', () => {
        media.duration = 60;
        renderStarted(760);

        expect(media.currentTime).toBeLessThan(60);
      });
    });

    it('applies resumeAt once: a new value while mounted changes nothing', () => {
      vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
      Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
        configurable: true,
        get: () => 4,
      });
      const { rerender, queryByText } = render(
        <HlsVideo url={URL} withCredentials resumeAt={0} />,
      );
      // The viewer has watched on to 4:05, and a save of 4:00 has just come
      // back and updated the cached resumeAt.
      media.currentTime = 245;

      rerender(<HlsVideo url={URL} withCredentials resumeAt={240} />);

      expect(media.currentTime).toBe(245);
      expect(queryByText(/Resumed at/)).toBeNull();
      Reflect.deleteProperty(HTMLMediaElement.prototype, 'readyState');
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

describe('HlsVideo captions', () => {
  const CAPTIONS = [
    {
      trackId: 'b',
      language: 'en-US',
      label: 'English',
      isDefault: true,
      url: 'https://media.example.com/video/n1/captions/b.vtt',
    },
    {
      trackId: 'a',
      language: 'es-ES',
      label: 'Spanish',
      isDefault: false,
      url: 'https://media.example.com/video/n1/captions/a.vtt',
    },
  ];
  const created: string[] = [];
  const revoked: string[] = [];
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
    created.length = 0;
    revoked.length = 0;
    fetchMock.mockReset().mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      text: async () => `WEBVTT\n\n00:00.000 --> 00:01.000\ncue of ${url}`,
    }));
    vi.stubGlobal('fetch', fetchMock);
    globalThis.URL.createObjectURL = vi.fn((blob: Blob) => {
      const url = `blob:${created.length}`;
      created.push(url);
      (globalThis as any).__blobs = {
        ...(globalThis as any).__blobs,
        [url]: blob,
      };
      return url;
    });
    globalThis.URL.revokeObjectURL = vi.fn((url: string) => {
      revoked.push(url);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const tracks = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('track')) as HTMLTrackElement[];

  it('has no captions control or track without captions', () => {
    const { queryByRole, container } = render(
      <HlsVideo url={URL} withCredentials />,
    );
    expect(queryByRole('button', { name: /^Captions/ })).toBeNull();
    expect(tracks(container)).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches each track and attaches it as a <track> on a blob URL', async () => {
    const { container, findByRole } = render(
      <HlsVideo url={URL} withCredentials captions={CAPTIONS} />,
    );

    expect(await findByRole('button', { name: /^Captions/ })).toBeTruthy();
    await waitFor(() => expect(tracks(container)).toHaveLength(2));
    expect(tracks(container).map((t) => t.getAttribute('src'))).toEqual([
      'blob:0',
      'blob:1',
    ]);
    const [english, spanish] = tracks(container);
    expect(english.getAttribute('srclang')).toBe('en-US');
    expect(english.getAttribute('label')).toBe('English');
    expect(english.getAttribute('kind')).toBe('captions');
    expect(spanish.getAttribute('srclang')).toBe('es-ES');
    // The file is held as WebVTT whatever the server called it.
    const blob = (globalThis as any).__blobs['blob:0'] as Blob;
    expect(blob.type).toBe('text/vtt');
    expect(await blob.text()).toContain('WEBVTT');
  });

  it('lifts cues that place themselves above the control bar, and leaves positioned ones', async () => {
    const { container } = render(
      <HlsVideo url={URL} withCredentials captions={CAPTIONS} />,
    );
    await waitFor(() => expect(tracks(container)).toHaveLength(2));
    const auto = { line: 'auto' };
    const placed = { line: 2 };
    const [english] = tracks(container);
    // jsdom doesn't load tracks, so give the element the cues it would have.
    Object.defineProperty(english, 'track', {
      value: { cues: [auto, placed] },
    });

    fireEvent.load(english);

    expect(auto.line).toBe(-4);
    expect(placed.line).toBe(2);
  });

  it('sends the signed cookies with the fetch only with withCredentials', async () => {
    const { unmount } = render(
      <HlsVideo url={URL} withCredentials captions={CAPTIONS} />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledWith(CAPTIONS[0].url, {
      credentials: 'include',
    });
    unmount();
    fetchMock.mockClear();

    render(<HlsVideo url={URL} withCredentials={false} captions={CAPTIONS} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledWith(CAPTIONS[0].url, undefined);
  });

  it('labels a translated track with the suffix, on the <track> and in the failure notice', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('a.vtt')
        ? { ok: false, status: 403, text: async () => '' }
        : { ok: true, status: 200, text: async () => 'WEBVTT' },
    );
    const translated = [
      CAPTIONS[0],
      { ...CAPTIONS[1], machineTranslated: true },
    ];
    const ok = render(
      <HlsVideo url={URL} withCredentials captions={translated} />,
    );
    await waitFor(() => expect(tracks(ok.container)).toHaveLength(1));
    expect(tracks(ok.container)[0].getAttribute('label')).toBe('English');
    await userEvent.click(await ok.findByRole('button', { name: /^Captions/ }));
    expect(await ok.findByRole('status')).toHaveTextContent(
      "Couldn't load captions: Spanish (auto-translated).",
    );
  });

  it('puts the suffix on a loaded translated <track>', async () => {
    const { container } = render(
      <HlsVideo
        url={URL}
        withCredentials
        captions={[CAPTIONS[0], { ...CAPTIONS[1], machineTranslated: true }]}
      />,
    );
    await waitFor(() => expect(tracks(container)).toHaveLength(2));
    expect(tracks(container).map((t) => t.getAttribute('label'))).toEqual([
      'English',
      'Spanish (auto-translated)',
    ]);
  });

  it('skips a track that fails to load, with a notice, and plays on', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('a.vtt')
        ? { ok: false, status: 403, text: async () => '' }
        : { ok: true, status: 200, text: async () => 'WEBVTT' },
    );
    const { container, findByRole } = render(
      <HlsVideo url={URL} withCredentials captions={CAPTIONS} />,
    );

    await waitFor(() => expect(tracks(container)).toHaveLength(1));
    expect(tracks(container)[0].getAttribute('label')).toBe('English');
    await userEvent.click(await findByRole('button', { name: /^Captions/ }));
    expect(await findByRole('status')).toHaveTextContent(
      "Couldn't load captions: Spanish.",
    );
    // The video is unaffected.
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('survives every fetch rejecting', async () => {
    fetchMock.mockRejectedValue(new Error('network'));
    const { container, getByRole } = render(
      <HlsVideo url={URL} withCredentials captions={CAPTIONS} />,
    );

    await waitFor(() =>
      expect(getByRole('button', { name: /^Captions/ })).toBeTruthy(),
    );
    expect(tracks(container)).toHaveLength(0);
    expect(getByRole('button', { name: 'Playback speed' })).toBeTruthy();
  });

  it('revokes the blob URLs on unmount', async () => {
    const { container, unmount } = render(
      <HlsVideo url={URL} withCredentials captions={CAPTIONS} />,
    );
    await waitFor(() => expect(tracks(container)).toHaveLength(2));

    unmount();

    expect(revoked.sort()).toEqual(['blob:0', 'blob:1']);
  });

  it('revokes a file that arrives after unmount', async () => {
    let finish: (value: unknown) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { unmount } = render(
      <HlsVideo url={URL} withCredentials captions={[CAPTIONS[0]]} />,
    );
    unmount();

    await act(async () => {
      finish({ ok: true, status: 200, text: async () => 'WEBVTT' });
    });

    await waitFor(() => expect(created).toHaveLength(1));
    expect(revoked).toEqual(created);
  });

  it('does not refetch when a refetch gives equal tracks', async () => {
    const { rerender, container } = render(
      <HlsVideo url={URL} withCredentials captions={CAPTIONS} />,
    );
    await waitFor(() => expect(tracks(container)).toHaveLength(2));

    rerender(
      <HlsVideo
        url={URL}
        withCredentials
        captions={CAPTIONS.map((c) => ({ ...c }))}
      />,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(revoked).toEqual([]);
  });

  describe('transcript', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());

    const VTT = `WEBVTT

00:01.000 --> 00:04.000
First line

00:05.000 --> 00:08.000
<v Ana>Fish &amp; chips

00:09.000 --> 00:12.000
Third line
`;
    const respondWith = (text: string) =>
      fetchMock.mockImplementation(async () => ({
        ok: true,
        status: 200,
        text: async () => text,
      }));
    const open = async (utils: ReturnType<typeof render>) => {
      await userEvent.click(
        await utils.findByRole('button', { name: 'Transcript' }),
      );
    };

    it('has no button and no layout wrapper without transcript', async () => {
      const { container, findByRole, queryByRole } = render(
        <HlsVideo url={URL} withCredentials captions={CAPTIONS} />,
      );
      await findByRole('button', { name: /^Captions/ });
      expect(queryByRole('button', { name: 'Transcript' })).toBeNull();
      expect(
        container.querySelector('[data-slot="hls-video-layout"]'),
      ).toBeNull();
    });

    it('lists the fetched file’s cues when opened, and saves that', async () => {
      respondWith(VTT);
      const utils = render(
        <HlsVideo url={URL} withCredentials captions={CAPTIONS} transcript />,
      );
      await utils.findByRole('button', { name: /^Captions/ });
      await open(utils);
      const panel = await utils.findByRole('region', {
        name: 'Transcript (English)',
      });
      await waitFor(() => expect(panel.querySelectorAll('li')).toHaveLength(3));
      expect(
        JSON.parse(localStorage.getItem('discava-video-preferences') as string)
          .transcriptOpen,
      ).toBe(true);
      expect(
        utils.container.querySelector('[data-slot="hls-video-layout"]'),
      ).not.toBeNull();
    });

    it('opens on mount when saved open', async () => {
      respondWith(VTT);
      localStorage.setItem(
        'discava-video-preferences',
        JSON.stringify({ transcriptOpen: true }),
      );
      const { findByRole } = render(
        <HlsVideo url={URL} withCredentials captions={CAPTIONS} transcript />,
      );
      expect(
        await findByRole('region', { name: /^Transcript/ }),
      ).toBeInTheDocument();
    });

    it('moves aria-current on timeupdate', async () => {
      respondWith(VTT);
      const utils = render(
        <HlsVideo url={URL} withCredentials captions={CAPTIONS} transcript />,
      );
      await open(utils);
      await utils.findByText('Third line');
      const current = () =>
        utils.container.querySelector('[aria-current="true"]');
      expect(current()).toBeNull();
      act(() => {
        media.currentTime = 6;
        video(utils.container).dispatchEvent(new Event('timeupdate'));
      });
      expect(current()).toHaveTextContent('Fish & chips');
    });

    it('seeks and plays when a line is chosen', async () => {
      respondWith(VTT);
      const utils = render(
        <HlsVideo url={URL} withCredentials captions={CAPTIONS} transcript />,
      );
      await open(utils);
      await userEvent.click(await utils.findByText('Third line'));
      expect(media.currentTime).toBe(9);
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    });

    it('keeps the arrow keys on the transcript away from the player', async () => {
      respondWith(VTT);
      const utils = render(
        <HlsVideo url={URL} withCredentials captions={CAPTIONS} transcript />,
      );
      await open(utils);
      const line = await utils.findByRole('button', { name: /Third line/ });
      line.focus();
      media.volume = 0.5;
      media.currentTime = 20;
      await userEvent.keyboard('{ArrowUp}{ArrowRight}');
      expect(media.volume).toBe(0.5);
      expect(media.currentTime).toBe(20);
    });

    it('ignores a rejected play', async () => {
      respondWith(VTT);
      HTMLMediaElement.prototype.play = vi.fn(() =>
        Promise.reject(new Error('blocked')),
      );
      const utils = render(
        <HlsVideo url={URL} withCredentials captions={CAPTIONS} transcript />,
      );
      await open(utils);
      await userEvent.click(await utils.findByText('Third line'));
      expect(media.currentTime).toBe(9);
    });

    it('follows the chosen caption track, and shows the default with captions off', async () => {
      fetchMock.mockImplementation(async (url: string) => ({
        ok: true,
        status: 200,
        text: async () =>
          `WEBVTT\n\n00:01.000 --> 00:02.000\n${url.endsWith('a.vtt') ? 'Hola' : 'Hello'}`,
      }));
      const utils = render(
        <HlsVideo url={URL} withCredentials captions={CAPTIONS} transcript />,
      );
      await open(utils);
      expect(await utils.findByText('Hello')).toBeInTheDocument();
      await userEvent.click(
        await utils.findByRole('button', { name: /^Captions/ }),
      );
      await userEvent.click(
        await utils.findByRole('menuitemradio', { name: 'Spanish' }),
      );
      expect(await utils.findByText('Hola')).toBeInTheDocument();
      expect(
        utils.getByRole('region', { name: 'Transcript (Spanish)' }),
      ).toBeInTheDocument();
      await userEvent.click(utils.getByRole('button', { name: /^Captions/ }));
      await userEvent.click(
        await utils.findByRole('menuitemradio', { name: 'Off' }),
      );
      expect(utils.getByText('Hola')).toBeInTheDocument();
    });

    it('shows cue text as plain text', async () => {
      respondWith(VTT);
      const utils = render(
        <HlsVideo url={URL} withCredentials captions={CAPTIONS} transcript />,
      );
      await open(utils);
      expect(await utils.findByText('Fish & chips')).toBeInTheDocument();
    });

    it('says the transcript couldn’t be loaded when every fetch fails', async () => {
      fetchMock.mockRejectedValue(new Error('network'));
      const utils = render(
        <HlsVideo url={URL} withCredentials captions={CAPTIONS} transcript />,
      );
      await open(utils);
      expect(
        await utils.findByText("This transcript couldn't be loaded."),
      ).toBeInTheDocument();
    });
  });
});

describe('HlsVideo onTimeChange', () => {
  const setup = (onTimeChange = vi.fn()) => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
    const { container } = render(
      <HlsVideo url={URL} withCredentials onTimeChange={onTimeChange} />,
    );
    return { el: video(container), onTimeChange };
  };
  const emit = (el: HTMLElement, type: string, at: number) =>
    act(() => {
      media.currentTime = at;
      el.dispatchEvent(new Event(type));
    });

  it('reports the current time on each time update', () => {
    const { el, onTimeChange } = setup();

    emit(el, 'timeupdate', 1.5);
    emit(el, 'timeupdate', 2);

    expect(onTimeChange.mock.calls).toEqual([[1.5], [2]]);
  });

  it('reports the time after a seek', () => {
    const { el, onTimeChange } = setup();

    emit(el, 'seeked', 42);

    expect(onTimeChange).toHaveBeenCalledWith(42);
  });

  it('uses the latest callback without restarting playback', () => {
    const first = vi.fn();
    const second = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
    const { container, rerender } = render(
      <HlsVideo url={URL} withCredentials onTimeChange={first} />,
    );
    rerender(<HlsVideo url={URL} withCredentials onTimeChange={second} />);

    emit(video(container), 'timeupdate', 3);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(3);
    expect(hls.instances).toHaveLength(1);
  });
});

describe('HlsVideo cues', () => {
  const cue = (id: string, atSeconds: number | null, state = 'unanswered') =>
    ({ id, atSeconds, state, label: id }) as any;

  const setup = (
    cues = [cue('a', 10), cue('b', 30), cue('end', null)],
    extra: { onPositionChange?: any } = {},
  ) => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
    const onCue = vi.fn();
    const result = render(
      <HlsVideo
        url={URL}
        withCredentials
        cues={cues}
        onCue={onCue}
        {...extra}
      />,
    );
    const el = video(result.container);
    act(() => {
      el.dispatchEvent(new Event('loadedmetadata'));
    });
    media.paused = false;
    return { el, onCue, ...result };
  };
  const emit = (el: HTMLElement, type: string, at?: number) =>
    act(() => {
      if (at !== undefined) {
        media.currentTime = at;
      }
      el.dispatchEvent(new Event(type));
    });

  it('reports the cue two time updates straddle', () => {
    const { el, onCue } = setup();

    emit(el, 'timeupdate', 9.5);
    emit(el, 'timeupdate', 10.1);

    expect(onCue).toHaveBeenCalledTimes(1);
    expect(onCue).toHaveBeenCalledWith(['a'], 'reached');
  });

  it('reports a cue once, not on the updates after it', () => {
    const { el, onCue } = setup();

    emit(el, 'timeupdate', 9.5);
    emit(el, 'timeupdate', 10.1);
    emit(el, 'timeupdate', 10.6);

    expect(onCue).toHaveBeenCalledTimes(1);
  });

  it('does not report an answered cue', () => {
    const { el, onCue } = setup([cue('a', 10, 'answered')]);

    emit(el, 'timeupdate', 9.5);
    emit(el, 'timeupdate', 10.1);

    expect(onCue).not.toHaveBeenCalled();
  });

  it('reaches a cue at 0 on the first update after play starts', () => {
    const { el, onCue } = setup([cue('z', 0)]);

    emit(el, 'timeupdate', 0.2);

    expect(onCue).toHaveBeenCalledWith(['z'], 'reached');
  });

  it('reports nothing while paused', () => {
    const { el, onCue } = setup();
    media.paused = true;

    emit(el, 'timeupdate', 9.5);
    emit(el, 'timeupdate', 10.1);

    expect(onCue).not.toHaveBeenCalled();
  });

  // FR-014: a seek across a cue doesn't ask it.
  it('reports nothing for a seek across a cue, nor for the update after it', () => {
    const { el, onCue } = setup();

    emit(el, 'timeupdate', 5);
    emit(el, 'seeking');
    emit(el, 'timeupdate', 12);
    emit(el, 'seeked', 12);
    emit(el, 'timeupdate', 12.2);

    expect(onCue).not.toHaveBeenCalled();
  });

  it('reports a cue passed by normal playback after a seek', () => {
    const { el, onCue } = setup();

    emit(el, 'seeking');
    emit(el, 'seeked', 29);
    emit(el, 'timeupdate', 29.2);
    emit(el, 'timeupdate', 30.1);

    expect(onCue).toHaveBeenCalledWith(['b'], 'reached');
  });

  it('reports nothing for a jump the events missed', () => {
    const { el, onCue } = setup();

    emit(el, 'timeupdate', 5);
    emit(el, 'timeupdate', 20);

    expect(onCue).not.toHaveBeenCalled();
  });

  it('reports the unanswered cues left at the end', () => {
    const { el, onCue } = setup([
      cue('a', 10, 'answered'),
      cue('end', null),
      cue('end2', null, 'answered'),
    ]);

    emit(el, 'ended');

    expect(onCue).toHaveBeenCalledWith(['end'], 'ended');
  });

  it('saves the position just before the open cue', () => {
    vi.useFakeTimers();
    const onPositionChange = vi.fn();
    const { el, rerender } = setup(undefined, { onPositionChange });
    emit(el, 'timeupdate', 9.5);
    emit(el, 'timeupdate', 10.1);

    rerender(
      <HlsVideo
        url={URL}
        withCredentials
        cues={[cue('a', 10), cue('b', 30), cue('end', null)]}
        onCue={vi.fn()}
        onPositionChange={onPositionChange}
        overlay={<p>Question</p>}
      />,
    );
    media.paused = true;
    emit(el, 'pause');

    expect(onPositionChange).toHaveBeenCalledWith({
      positionSeconds: 9,
      durationSeconds: 120,
    });
  });

  it('saves the playhead when no overlay is open', () => {
    vi.useFakeTimers();
    const onPositionChange = vi.fn();
    const { el } = setup(undefined, { onPositionChange });
    emit(el, 'timeupdate', 5.2);
    emit(el, 'timeupdate', 5.8);
    media.paused = true;
    emit(el, 'pause');

    expect(onPositionChange).toHaveBeenCalledWith({
      positionSeconds: 5.8,
      durationSeconds: 120,
    });
  });

  it('shows a marker for each timed cue', () => {
    const { container } = setup();
    emit(video(container), 'durationchange');
    expect(
      container.querySelectorAll('[data-slot="video-cue-marker"]'),
    ).toHaveLength(2);
  });

  it('changes nothing without cues', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
    const { container } = render(<HlsVideo url={URL} withCredentials />);
    expect(container.querySelector('[data-slot="video-overlay"]')).toBeNull();
  });
});
