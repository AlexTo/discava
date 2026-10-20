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

    const { container } = render(<HlsVideo url={URL} title="Lecture 1" />);

    expect(video(container).src).toBe(URL);
    expect(video(container).getAttribute('aria-label')).toBe('Lecture 1');
    expect(hls.instances).toHaveLength(0);
  });

  it('plays through hls.js elsewhere, sending the signed cookies', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');

    const { container } = render(<HlsVideo url={URL} />);

    const [instance] = hls.instances;
    expect(instance.loadSource).toHaveBeenCalledWith(URL);
    expect(instance.attachMedia).toHaveBeenCalledWith(video(container));
    const xhr = { withCredentials: false };
    instance.config.xhrSetup(xhr);
    expect(xhr.withCredentials).toBe(true);
  });
});
