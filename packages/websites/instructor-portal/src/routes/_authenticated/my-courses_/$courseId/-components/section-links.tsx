/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Link, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

export type Section = { id: string; label: string };

const LINK_CLASS =
  'inline-flex min-h-6 shrink-0 items-center rounded-full border px-3 py-1 text-sm font-medium text-primary hover:bg-muted';

/**
 * A row of links to the sections on the course editor, each kept in the
 * address as `#<id>`. After the address's hash changes the section's heading
 * is focused and scrolled into view. Each heading has `scroll-mt-20` so it
 * lands below the portal's sticky `h-16` header instead of behind it.
 *
 * `ready` holds the scroll back while the page is still loading parts that
 * change its height, so a section's address opened in a new tab isn't pushed
 * off screen by content that arrives after the scroll. `settled` is asked
 * again just before scrolling, after the commit's effects: sections that
 * load their own data only start their queries in those effects. Each hash is scrolled to once, so a later
 * refetch doesn't pull the page back to it.
 */
export function SectionLinks({
  sections,
  ready = true,
  settled,
}: {
  sections: Section[];
  ready?: boolean;
  settled?: () => boolean;
}) {
  const hash = useRouterState({ select: (state) => state.location.hash });
  const scrolledTo = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!hash || !ready || scrolledTo.current === hash) {
      return;
    }
    const goToSection = () => {
      const heading = document.getElementById(hash);
      if (!heading) {
        return;
      }
      scrolledTo.current = hash;
      const reduceMotion = window.matchMedia?.(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth' });
    };
    if (!settled) {
      goToSection();
      return;
    }
    // After this commit's effects, so the queries the sections just started
    // are counted. If one is running, `ready` turns false and true again once
    // it ends, and this runs again.
    const timer = setTimeout(() => {
      if (settled()) {
        goToSection();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [hash, ready]);

  return (
    <nav aria-label="Course sections">
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {sections.map(({ id, label }) => (
          <li key={id} className="shrink-0">
            <Link to="." hash={id} className={LINK_CLASS}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
