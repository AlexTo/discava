/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback, useEffect, useRef } from 'react';

const FIRST_CONTROL = 'button:not([disabled]), a[href], input:not([disabled])';

const dialogOpen = () =>
  document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;

// Keeps keyboard focus in a list when one of its items goes (deleted,
// archived, restored): once the item has left the list and focus has fallen to
// the page, focus moves to the next item's first control, else the previous
// one's, else `fallback` (a heading made focusable with tabIndex -1).
//
// Give each item's element to the returned `register(id)` as its ref.
export function useFocusAfterRemoval(
  ids: string[],
  fallback: () => HTMLElement | null,
) {
  const elements = useRef(new Map<string, HTMLElement>());
  const previousIds = useRef(ids);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  const idsKey = ids.join('\u0000');

  const register = useCallback(
    (id: string) => (element: Element | null) => {
      if (element instanceof HTMLElement) {
        elements.current.set(id, element);
      } else {
        elements.current.delete(id);
      }
    },
    [],
  );

  useEffect(() => {
    const before = previousIds.current;
    previousIds.current = ids;
    const removedAt = before.findIndex((id) => !ids.includes(id));
    if (removedAt === -1) {
      return;
    }
    // The nearest surviving item after the removed one, else before it.
    const neighbour =
      before.slice(removedAt + 1).find((id) => ids.includes(id)) ??
      [...before.slice(0, removedAt)].reverse().find((id) => ids.includes(id));

    let timer: ReturnType<typeof setTimeout>;
    let tries = 0;
    // A closing dialog hands focus back to its (now gone) trigger after this
    // render, so wait for it to finish before looking at where focus is.
    const settle = () => {
      if (dialogOpen() && tries++ < 20) {
        timer = setTimeout(settle, 50);
        return;
      }
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) {
        return;
      }
      const target =
        (neighbour === undefined
          ? null
          : elements.current
              .get(neighbour)
              ?.querySelector<HTMLElement>(FIRST_CONTROL)) ??
        fallbackRef.current();
      target?.focus();
    };
    timer = setTimeout(settle, 0);
    return () => clearTimeout(timer);
  }, [idsKey]);

  return { register };
}
