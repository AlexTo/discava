/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MAIN_CONTENT_ID, SkipLink } from './skip-link';

describe('SkipLink', () => {
  it('moves focus to the main content instead of navigating', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(
      <>
        <SkipLink />
        <div id={MAIN_CONTENT_ID} tabIndex={-1}>
          content
        </div>
      </>,
    );

    await userEvent.tab();
    const link = screen.getByRole('link', { name: 'Skip to Main Content' });
    expect(link).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    expect(document.getElementById(MAIN_CONTENT_ID)).toHaveFocus();
  });
});
