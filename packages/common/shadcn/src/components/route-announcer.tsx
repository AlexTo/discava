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
 * for up to 5 seconds. Never writes `document.title`: each route does that.
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

  useEffect(() => {
    const mark = () => {
      interacted.current = true;
    };
    window.addEventListener('keydown', mark, true);
    window.addEventListener('pointerdown', mark, true);
    return () => {
      window.removeEventListener('keydown', mark, true);
      window.removeEventListener('pointerdown', mark, true);
    };
  }, []);

  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    if (!interacted.current) return;

    const focusHeading = () => {
      const heading = document
        .getElementById(containerId)
        ?.querySelector<HTMLElement>('h1');
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
