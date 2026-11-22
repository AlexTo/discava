/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useRef } from 'react';

const WAIT_MS = 5000;

/**
 * Moves focus to the new page's first `h1` when `pathname` changes (not on
 * first render and not before the user's first key or click), so a keyboard user starts at the top of the page and a
 * screen reader reads its name. Waits for the heading with a MutationObserver
 * for up to 5 seconds. Leaves focus be when the new page has moved it into the
 * container itself (a lesson opened at a video, say): this effect runs after
 * the page's own, so it would otherwise take focus back. Never writes
 * `document.title`: each route does that.
 */
export function RouteAnnouncer({
  containerId,
  pathname,
}: {
  containerId: string;
  pathname: string;
}) {
  const previous = useRef(pathname);
  // A path change before the user has pressed a key or clicked is the page
  // settling (a sign-in redirect, say), not a link followed: leave focus be.
  const interacted = useRef(false);
  // What the last key or click was aimed at, and an element focus has moved
  // to since that isn't it (the link followed takes focus too, and doesn't
  // count): the new page's own choice.
  const interactionTarget = useRef<Node | null>(null);
  const movedTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const mark = (event: Event) => {
      interacted.current = true;
      interactionTarget.current = event.target as Node;
      movedTo.current = null;
    };
    const focused = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      if (!target.contains(interactionTarget.current)) {
        movedTo.current = target;
      }
    };
    window.addEventListener('keydown', mark, true);
    window.addEventListener('pointerdown', mark, true);
    document.addEventListener('focusin', focused, true);
    return () => {
      window.removeEventListener('keydown', mark, true);
      window.removeEventListener('pointerdown', mark, true);
      document.removeEventListener('focusin', focused, true);
    };
  }, []);

  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    if (!interacted.current) return;

    const focusHeading = () => {
      const container = document.getElementById(containerId);
      const moved = movedTo.current;
      if (
        moved &&
        moved === document.activeElement &&
        container?.contains(moved)
      ) {
        return true;
      }
      const heading = container?.querySelector<HTMLElement>('h1');
      if (!heading) return false;
      heading.tabIndex = -1;
      heading.classList.add('focus-visible:outline-none', 'outline-none');
      heading.focus();
      return true;
    };
    if (focusHeading()) return;

    const container = document.getElementById(containerId) ?? document.body;
    const observer = new MutationObserver(() => {
      if (focusHeading()) observer.disconnect();
    });
    observer.observe(container, { childList: true, subtree: true });
    const timer = setTimeout(() => observer.disconnect(), WAIT_MS);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [containerId, pathname]);

  return null;
}
