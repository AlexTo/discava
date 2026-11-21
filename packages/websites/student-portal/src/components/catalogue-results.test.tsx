/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { type CatalogueFilters, NO_FILTERS } from '../lib/catalogue-filters';
import { renderWithCoreApi } from '../test/render-with-core-api';
import { CatalogueResults } from './catalogue-results';

const facets = {
  categories: [],
  tags: [{ value: 'sql', count: 2 }],
  levels: [
    { value: 'beginner', count: 2 },
    { value: 'advanced', count: 1 },
  ],
  languages: [],
  durationBands: [],
};

const page = (title: string) => ({
  items: [{ courseId: title, title, tags: [] }],
  cursor: null,
  facets,
});

function Harness({ initial = NO_FILTERS }: { initial?: CatalogueFilters }) {
  const [filters, setFilters] = useState(initial);
  return <CatalogueResults filters={filters} onFiltersChange={setFilters} />;
}

describe('CatalogueResults filters', () => {
  it('keeps the panel, focus and results while a filter change loads', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { calls, user } = renderWithCoreApi(<Harness />, {
      signedIn: false,
      handlers: {
        'course.publicSearch': async (input) => {
          if ((input as { levels?: string[] }).levels) {
            await gate;
            return page('Filtered');
          }
          return page('Everything');
        },
      },
    });

    const checkbox = await screen.findByRole('checkbox', {
      name: /Beginner/,
    });
    checkbox.focus();
    await user.keyboard(' ');

    // The second response is pending: the panel and the old results stay.
    await waitFor(() =>
      expect(document.querySelector('[aria-busy="true"]')).not.toBeNull(),
    );
    expect(screen.getByRole('checkbox', { name: /Beginner/ })).toBe(checkbox);
    expect(screen.getByText('Everything')).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toHaveClass(
      'opacity-60',
    );

    release();
    expect(await screen.findByText('Filtered')).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(document.activeElement).toBe(checkbox);
    expect(
      calls.filter(({ path }) => path === 'course.publicSearch').at(-1)?.input,
    ).toEqual({ levels: ['beginner'], limit: 12, direction: 'forward' });
  });

  it('shows how many filters are active on the Filters trigger', async () => {
    renderWithCoreApi(
      <Harness
        initial={{
          ...NO_FILTERS,
          levels: ['beginner'],
          tags: ['sql'],
        }}
      />,
      {
        signedIn: false,
        handlers: { 'course.publicSearch': () => page('Everything') },
      },
    );

    const trigger = await screen.findByRole('button', { name: /Filters/ });
    expect(trigger).toHaveTextContent('Filters');
    expect(trigger).toHaveTextContent('2 active');
  });

  it('shows no count when no filter is set', async () => {
    renderWithCoreApi(<Harness />, {
      signedIn: false,
      handlers: { 'course.publicSearch': () => page('Everything') },
    });

    const trigger = await screen.findByRole('button', { name: /Filters/ });
    expect(trigger).not.toHaveTextContent('active');
  });

  it('toggles a checkbox from its count, and keeps its accessible name', async () => {
    const { user } = renderWithCoreApi(<Harness />, {
      signedIn: false,
      handlers: { 'course.publicSearch': () => page('Everything') },
    });

    const checkbox = await screen.findByRole('checkbox', {
      name: 'Beginner (2)',
    });
    expect(checkbox).not.toBeChecked();
    await user.click(
      within(
        screen
          .getByText('Beginner', { exact: false })
          .closest('label') as HTMLElement,
      ).getByText('(2)'),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: 'Beginner (2)' }),
      ).toBeChecked(),
    );
  });
});
