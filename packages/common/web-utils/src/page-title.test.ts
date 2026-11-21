/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { pageTitle } from './page-title';

describe('pageTitle', () => {
  it('joins the parts and the application name', () => {
    expect(pageTitle('Projections', 'Linear Algebra')).toBe(
      'Projections · Linear Algebra · Discava',
    );
  });

  it('is the application name alone without parts', () => {
    expect(pageTitle()).toBe('Discava');
    expect(pageTitle(undefined, '')).toBe('Discava');
  });

  it('drops null, false and empty parts', () => {
    expect(pageTitle(null, 'Home', false, '')).toBe('Home · Discava');
  });
});
