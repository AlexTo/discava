/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePublicMediaUrl } from './public-media-url';
import { RuntimeConfigProvider, useRuntimeConfig } from './runtime-config';

function ShowConfig() {
  const config = useRuntimeConfig();
  return <p>apis: {JSON.stringify(config.apis)}</p>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useRuntimeConfig', () => {
  it('throws outside RuntimeConfigProvider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ShowConfig />)).toThrow(
      'useRuntimeConfig must be used within a RuntimeConfigProvider',
    );
  });
});

describe('RuntimeConfigProvider', () => {
  it('shows the fallback, then the fetched runtime-config.json, if not in local-dev mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ apis: { InstructorApi: 'https://api.test/' } }),
          ),
      ),
    );

    render(
      <RuntimeConfigProvider
        localDevConfig={{ apis: { Local: 'http://localhost/' } }}
        fallback={<p>loading</p>}
      >
        <ShowConfig />
      </RuntimeConfigProvider>,
    );

    expect(screen.getByText('loading')).toBeTruthy();
    expect(screen.queryByText(/apis:/)).toBeNull();
    expect(
      await screen.findByText('apis: {"InstructorApi":"https://api.test/"}'),
    ).toBeTruthy();
  });

  it('falls back to an empty config if runtime-config.json fails to load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    render(
      <RuntimeConfigProvider localDevConfig={{}}>
        <ShowConfig />
      </RuntimeConfigProvider>,
    );

    expect(await screen.findByText('apis: {}')).toBeTruthy();
  });

  it("uses the portal's local dev config in local-dev mode, without fetching", async () => {
    vi.stubEnv('MODE', 'local-dev');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <RuntimeConfigProvider
        localDevConfig={{ apis: { CoreApi: 'http://localhost:2022/' } }}
      >
        <ShowConfig />
      </RuntimeConfigProvider>,
    );

    expect(
      await screen.findByText('apis: {"CoreApi":"http://localhost:2022/"}'),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

describe('usePublicMediaUrl', () => {
  function Url({ imageKey }: { imageKey?: string }) {
    const url = usePublicMediaUrl()(imageKey);
    return <p>url: {String(url)}</p>;
  }

  it('resolves a key under the public media base URL', async () => {
    vi.stubEnv('MODE', 'local-dev');
    render(
      <RuntimeConfigProvider
        localDevConfig={{
          media: { PublicMediaBucket: 'http://media.test/b/' },
        }}
      >
        <Url imageKey="courses/c1.png" />
      </RuntimeConfigProvider>,
    );
    expect(
      await screen.findByText('url: http://media.test/b/courses/c1.png'),
    ).toBeTruthy();
    vi.unstubAllEnvs();
  });

  it('is undefined without a key or a base URL', async () => {
    vi.stubEnv('MODE', 'local-dev');
    render(
      <RuntimeConfigProvider localDevConfig={{}}>
        <Url imageKey="courses/c1.png" />
      </RuntimeConfigProvider>,
    );
    expect(await screen.findByText('url: undefined')).toBeTruthy();
    vi.unstubAllEnvs();
  });
});
