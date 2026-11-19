/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PostText } from './post-text';

describe('PostText', () => {
  it('renders markup as text and keeps line breaks', () => {
    const { container } = render(
      <PostText>{'<script>alert(1)</script>\n<b>bold</b>'}</PostText>,
    );
    const text = screen.getByText(/alert/);
    expect(text.textContent).toBe('<script>alert(1)</script>\n<b>bold</b>');
    expect(container.querySelector('script, b')).toBeNull();
    expect(text).toHaveClass('whitespace-pre-line', 'break-words');
  });
});
