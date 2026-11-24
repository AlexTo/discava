# Quickstart: checking the course editor section menu

How to check the menu by hand on the local stack. The automated checks are the component tests beside `section-menu.tsx` and `unsaved-changes-context.tsx`, and the e2e steps named in [tasks.md](./tasks.md). This guide is for the reviewer and the **(human)** tasks.

## Prerequisites

1. Start Docker, then run `pnpm dev`; the instructor portal is at <http://localhost:4200>.
2. Sign in under "Someone else" as a new user with the `instructor` group.
3. Make a course with 3 modules of 3 lessons, an announcement, and one archived lesson, so every section shows.
4. Have two windows ready: **375×812** and **1440×900**.

## US1: the menu stays on screen and marks the current section

At 1440px:

1. Open the course. The "Course sections" menu is down the side of the editor, beside "Course content", and "Content" is marked.
2. Use each link in turn. The page scrolls to the section, its heading is below the header, focus is on the heading, the address ends in `#<section>`, and that link is marked. During the smooth scroll, the mark doesn't flicker through the sections in between.
3. Scroll slowly from top to bottom without using the menu. The menu stays in place, and the mark moves to each section as its heading passes under the header. At the end of the page, the last section is marked.
4. Collapse the portal's sidebar. The menu stays beside the sections.

At 375px:

5. Open the course. The row of links is under the header card. Scroll down: it sticks under the portal's header.
6. Use "Announcements". The row is still on screen, "Announcements" is marked and scrolled into the row's view, and its heading is visible below the row.
7. Scroll back to the top: "Content" is marked and the row has scrolled back to show it. The page never scrolls sideways.

Resize the 1440px window down to 1000px and back: the menu changes layout and keeps the same section marked.

## US2: the current section is told, not only shown

1. With a screen reader on, Tab to the menu. The marked link is announced as the current location, and no other link is.
2. Turn on greyscale (DevTools → Rendering → Emulate vision deficiencies → Achromatopsia). The marked link still stands out.
3. Turn on reduced motion (DevTools → Rendering → `prefers-reduced-motion: reduce`). Using a link jumps, with no smooth scroll.
4. At 1440px, zoom to 200%. The menu scrolls within itself and every link can be reached.

## US3: unsaved changes are visible from anywhere

1. Change the price without saving. Scroll to Announcements. The menu's Price link has a dot; a screen reader reads it as "Price, unsaved changes".
2. Save the price. The dot is gone.
3. Start a new announcement and type a title. The Announcements link has the dot; cancel it, and the dot goes.
4. Archive the course. No link has a dot.

## Same requests

With DevTools' Network panel open, load the editor and use every link before and after the change. The list of requests is the same (FR-011, SC-005).
