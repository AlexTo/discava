/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusFirstInvalid } from './focus-first-invalid';

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('focusFirstInvalid', () => {
  it('focuses the first field marked invalid, in page order', () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <form>
        <input id="a" aria-invalid="false" />
        <input id="b" aria-invalid="true" />
        <input id="c" aria-invalid="true" />
      </form>`;

    focusFirstInvalid(document.querySelector('form'));
    vi.runAllTimers();

    expect(document.activeElement?.id).toBe('b');
  });

  it('leaves focus alone when nothing is invalid, or there is no form', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<input id="a" /><input id="b" />';
    document.getElementById('a')?.focus();

    focusFirstInvalid(document.body);
    focusFirstInvalid(null);
    vi.runAllTimers();

    expect(document.activeElement?.id).toBe('a');
  });
});
