/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { pageTitle } from './page-title';

describe('pageTitle', () => {
  it('joins the parts and the application name', () => {
    expect(pageTitle('Discava', 'Projections', 'Linear Algebra')).toBe(
      'Projections · Linear Algebra · Discava',
    );
  });

  it('is the application name alone without parts', () => {
    expect(pageTitle('Discava')).toBe('Discava');
    expect(pageTitle('Discava', undefined, '')).toBe('Discava');
  });

  it('ends with the name it is given', () => {
    expect(pageTitle('Acme Academy', 'Courses')).toBe('Courses · Acme Academy');
  });

  it('drops null, false and empty parts', () => {
    expect(pageTitle('Discava', null, 'Home', false, '')).toBe(
      'Home · Discava',
    );
  });
});
