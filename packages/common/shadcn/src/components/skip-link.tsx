/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/** The `id` of the element `SkipLink` jumps to; put it on the page's content wrapper. */
export const MAIN_CONTENT_ID = 'main-content';

/**
 * A link that stays hidden until a keyboard user tabs to it, then jumps past
 * the header and navigation to the page content. Render it first in the
 * layout, and give the content wrapper `id={MAIN_CONTENT_ID}` and
 * `tabIndex={-1}` so the jump moves focus there.
 */
export function SkipLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      // The portals set `<base href="/">`, which would turn a bare `#hash`
      // link into a navigation to the home page, so move focus ourselves.
      onClick={(event) => {
        const target = document.getElementById(MAIN_CONTENT_ID);
        if (target) {
          event.preventDefault();
          target.focus();
          target.scrollIntoView();
        }
      }}
      className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-[100] focus-visible:rounded-md focus-visible:bg-background focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      Skip to Main Content
    </a>
  );
}
