/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useRef } from 'react';

const WAIT_MS = 5000;

/**
 * Moves focus to the new page's first `h1` when `pathname` changes (not on
 * first render), so a keyboard user starts at the top of the page and a
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

  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;

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
