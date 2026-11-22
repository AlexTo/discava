/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithCoreApi } from '../../../../test/render-with-core-api';
import { TranscriptSearchBox } from './transcript-search-box';

const setup = (query?: string) =>
  renderWithCoreApi(<TranscriptSearchBox courseId="course-1" query={query} />);

const form = () =>
  screen.findByRole('search', { name: "Search this course's transcripts" });
const input = () =>
  screen.findByRole('textbox', { name: 'Search transcripts' });

describe('TranscriptSearchBox', () => {
  it('goes to the results with the trimmed text on submit', async () => {
    const { user, router } = setup();

    await user.type(await input(), '  gradient descent  ');
    await user.click(await screen.findByRole('button', { name: 'Search' }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/learn/course-1/search'),
    );
    expect(router.state.location.search).toEqual({ q: 'gradient descent' });
  });

  it('does not navigate on one character, and says why', async () => {
    const { user, router } = setup();

    await user.type(await input(), ' a ');
    await user.click(await screen.findByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Type at least 2 characters')).toBeVisible();
    expect(router.state.location.pathname).toBe('/');
  });

  it('takes at most 200 characters', async () => {
    setup();
    expect(await input()).toHaveAttribute('maxlength', '200');
    expect(await form()).toBeInTheDocument();
  });

  it('shows the current query', async () => {
    setup('gradient');
    expect(await input()).toHaveValue('gradient');
  });

  it('requests nothing while typing', async () => {
    const { user, calls } = setup();

    await user.type(await input(), 'gradient descent');

    expect(calls).toEqual([]);
  });
});
