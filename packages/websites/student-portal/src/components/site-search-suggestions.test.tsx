/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  PUBLIC_MEDIA_URL,
  renderWithCoreApi,
} from '../test/render-with-core-api';
import { SiteSearchSuggestions } from './site-search-suggestions';

const render = (
  props: Partial<Parameters<typeof SiteSearchSuggestions>[0]> = {},
) =>
  renderWithCoreApi(
    <SiteSearchSuggestions
      id="list"
      activeIndex={-1}
      items={[]}
      typed=""
      loading={false}
      onChoose={() => {}}
      {...props}
    />,
    { signedIn: false },
  );

describe('SiteSearchSuggestions', () => {
  it('marks the typed start of each word in the title', async () => {
    const { container } = render({
      items: [{ courseId: 'c1', title: 'Python for Data' }],
      typed: 'pyth da',
    });
    await screen.findByRole('option');

    expect(
      [...container.querySelectorAll('mark')].map((mark) => mark.textContent),
    ).toEqual(['Pyth', 'Da']);
    expect(screen.getByRole('option')).toHaveTextContent('Python for Data');
  });

  it('shows the course image when it has one, and a placeholder otherwise', async () => {
    const { container } = render({
      items: [
        { courseId: 'c1', title: 'With image', imageKey: 'courses/c1.png' },
        { courseId: 'c2', title: 'Without image' },
      ],
    });
    await screen.findAllByRole('option');

    const images = container.querySelectorAll('img');
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute(
      'src',
      `${PUBLIC_MEDIA_URL}courses/c1.png`,
    );
  });

  it('reports the chosen course, without taking focus from the box', async () => {
    const onChoose = vi.fn();
    render({
      items: [{ courseId: 'c1', title: 'Python Basics' }],
      onChoose,
    });
    const row = await screen.findByRole('option', { name: 'Python Basics' });

    const notPrevented = fireEvent.mouseDown(row);
    fireEvent.click(row);

    expect(notPrevented).toBe(false);
    expect(onChoose).toHaveBeenCalledWith('c1');
  });

  it('says it is searching while it has nothing to show', async () => {
    render({ loading: true });

    expect(await screen.findByText('Searching…')).toBeInTheDocument();
  });
});
