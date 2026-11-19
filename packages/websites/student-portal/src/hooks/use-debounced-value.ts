/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * `value` once it has stayed unchanged for `delayMs`, and a `cancel()` that
 * drops the update still waiting (a later change schedules a new one).
 */
export const useDebouncedValue = <T>(
  value: T,
  delayMs: number,
): [T, () => void] => {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const cancel = useCallback(() => clearTimeout(timer.current), []);

  useEffect(() => {
    timer.current = setTimeout(() => setDebounced(value), delayMs);
    return cancel;
  }, [value, delayMs, cancel]);

  return [debounced, cancel];
};
