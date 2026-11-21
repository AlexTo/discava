/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePageTitle } from './use-page-title';

function Page({ name }: { name?: string }) {
  usePageTitle(name, 'Course');
  return null;
}

describe('usePageTitle', () => {
  it('sets the title and updates it when the parts change', () => {
    const { rerender } = render(<Page />);
    expect(document.title).toBe('Course · Discava');
    rerender(<Page name="Lesson" />);
    expect(document.title).toBe('Lesson · Course · Discava');
  });
});
