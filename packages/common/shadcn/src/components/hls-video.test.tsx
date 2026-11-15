/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  vi.restoreAllMocks();
  hls.instances.length = 0;
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
});
