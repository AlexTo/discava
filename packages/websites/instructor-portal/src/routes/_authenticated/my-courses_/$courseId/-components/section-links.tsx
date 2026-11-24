/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Link, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';

export type Section = { id: string; label: string };

const LINK_CLASS =
  'inline-flex min-h-6 shrink-0 items-center rounded-full border px-3 py-1 text-sm font-medium text-primary hover:bg-muted';

/**
 * A row of links to the sections on the course editor, each kept in the
 * address as `#<id>`. After the address's hash changes the section's heading
 * is focused and scrolled into view. Each heading has `scroll-mt-20` so it
 * lands below the portal's sticky `h-16` header instead of behind it.
 */
export function SectionLinks({ sections }: { sections: Section[] }) {
  const hash = useRouterState({ select: (state) => state.location.hash });

  useEffect(() => {
    if (!hash) {
      return;
    }
    const heading = document.getElementById(hash);
    if (!heading) {
      return;
    }
    const reduceMotion = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [hash]);

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
