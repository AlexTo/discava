/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RadioGroup, RadioGroupItem } from './radio-group';

describe('RadioGroupItem', () => {
  // The radio is 16px with a 1px border, so the ::after is offset from a 14px
  // padding box: 5px on every side makes the 24px target.
  it('widens its hit area to 24px, 5px past each side of the circle', () => {
    render(
      <RadioGroup>
        <RadioGroupItem value="a" aria-label="Option 1 is correct" />
      </RadioGroup>,
    );
    expect(
      screen.getByRole('radio', { name: 'Option 1 is correct' }),
    ).toHaveClass('size-4', 'relative', 'after:absolute', 'after:-inset-[5px]');
  });
});
