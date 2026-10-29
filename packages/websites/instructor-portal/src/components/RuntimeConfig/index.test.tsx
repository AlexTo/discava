/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRuntimeConfig } from '../../hooks/useRuntimeConfig';
import RuntimeConfigProvider from './index';

function ShowConfig() {
  const config = useRuntimeConfig();
  return <p>apis: {JSON.stringify(config.apis)}</p>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RuntimeConfigProvider', () => {
  it('shows a spinner, then the fetched runtime-config.json, if not in local-dev mode', async () => {
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
      <RuntimeConfigProvider>
        <ShowConfig />
      </RuntimeConfigProvider>,
    );

    expect(screen.queryByText(/apis:/)).not.toBeInTheDocument();
    expect(
      await screen.findByText('apis: {"InstructorApi":"https://api.test/"}'),
    ).toBeInTheDocument();
  });

  it('falls back to an empty config if runtime-config.json fails to load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    render(
      <RuntimeConfigProvider>
        <ShowConfig />
      </RuntimeConfigProvider>,
    );

    expect(await screen.findByText('apis: {}')).toBeInTheDocument();
  });
});
