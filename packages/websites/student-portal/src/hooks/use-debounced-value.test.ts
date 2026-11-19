/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from './use-debounced-value';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useDebouncedValue', () => {
  it('gives the first value at once', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 300));

    expect(result.current[0]).toBe('a');
  });

  it('updates once after a burst of changes', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: '' } },
    );

    for (const value of ['j', 'ja', 'jav', 'java']) {
      rerender({ value });
      act(() => {
        vi.advanceTimersByTime(100);
      });
    }
    expect(result.current[0]).toBe('');
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current[0]).toBe('java');
  });

  it('does not update before the delay', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'ab' });
    act(() => {
      vi.advanceTimersByTime(299);
    });

    expect(result.current[0]).toBe('a');
  });

  it('drops the pending update on cancel()', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'ab' });
    act(() => result.current[1]());
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(result.current[0]).toBe('a');
  });

  it('clears the timer on unmount', () => {
    const { rerender, unmount } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'ab' });
    expect(vi.getTimerCount()).toBe(1);
    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
