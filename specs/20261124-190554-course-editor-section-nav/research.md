# Research: Course Editor Section Menu

Each entry records a decision the plan rests on, why, and what else was considered. Paths are relative to `packages/websites/instructor-portal/src/routes/_authenticated/my-courses_/$courseId/` unless they start with `packages/`.

## R-1: Where the editor scrolls, and whether `sticky` works there

**Decision**: The menu uses CSS `position: sticky` against the window's scroll.

**Rationale**:

- The page scrolls the window, not an inner element. `PortalShell` (`packages/common/shadcn/src/components/portal-shell.tsx`) renders `SidebarInset` with no `overflow`, and its header is already `sticky top-0 h-16`. The existing e2e steps scroll with `window.scrollTo`.
- The editor's own wrapper (`route.tsx`, `mx-auto w-full max-w-5xl space-y-6`) and `UnsavedChangesProvider` add no `overflow`, so nothing between the menu and the window breaks `sticky`.
- The student portal's public course page already has a `sticky top-16` "Course sections" bar (`packages/websites/student-portal/src/routes/learn/$courseId/-components/course-page.tsx`), so the pattern is proven under the same header height.

**Alternatives considered**: a `fixed` menu positioned by script. Rejected: it needs width and offset sums the browser already does for `sticky`, and it breaks when the portal's sidebar collapses.

## R-2: Layout at 1280px and above

**Decision**: From `xl` (1280px), the part of the editor below the header card becomes a two-column grid: `xl:grid xl:grid-cols-[12rem_minmax(0,1fr)] xl:gap-8`. The menu is the first column, `xl:sticky xl:top-20 xl:self-start` with `xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto`. The sections are the second column. The editor's wrapper widens from `max-w-5xl` to `xl:max-w-[calc(64rem+14rem)]` so the sections keep their current maximum width of 1024px when there is room.

**Rationale**:

- The portal's sidebar is 16rem (256px) wide from `md` up (`SIDEBAR_WIDTH` in `ui/sidebar.tsx`), and `main` has `p-6`. At 1280px the editor gets about 976px: 192px for the menu, 32px of gap and about 750px for the sections, which is enough for every settings form. At 1024px (`lg`) the sections would get about 500px, too narrow for the catalogue and price forms, so `lg` is rejected (spec Clarifications).
- The header card stays above the grid at full width (spec Assumptions), so only the sections move.
- `minmax(0, 1fr)` keeps a long title from widening the column (UI rules, Layout).
- `max-h` with `overflow-y-auto` makes the list scroll within itself at 200% zoom (spec Edge Cases).
- `top-20` (80px) clears the 64px header with 16px to spare, the same space the `p-6 pt-4` of `main` leaves at the top today.

**Alternatives considered**: putting the menu in `ResponsivePanel`. Rejected: that component is for side panels that close on a phone, while this menu must stay on screen at every width. Using the portal's own sidebar to list the sections was also rejected: it belongs to the shell, holds the portal's pages, and collapses into a sheet below `md`.

## R-3: Layout below 1280px

**Decision**: The menu is the same element, styled as a row: `sticky top-16 z-[5] -mx-6 border-b bg-background/95 px-6 backdrop-blur xl:mx-0 xl:border-0 xl:px-0 xl:bg-transparent`, with the existing `overflow-x-auto` list inside. One `nav` element serves both widths, switching layout with `xl:` classes, so there is never a second "Course sections" landmark and the e2e locators keep working.

**Rationale**:

- `top-16` puts it directly under the 64px header, as the student course page does. Its `z-index` sits below the header's `z-10` so the header's menus and the notification popover still overlap it.
- `-mx-6 px-6` runs the bar's background edge to edge of `main`, so content scrolling under it doesn't show at its sides.
- Two elements (a side list and a row) shown by breakpoint would duplicate the landmark for screen readers whenever CSS failed to hide one, and double every test locator. Rejected.

## R-4: How the current section is found

**Decision**: A route-private hook, `-components/use-current-section.ts`, takes the ordered section ids and returns the current id. It:

1. Listens to the window's `scroll` (passive) and `resize`, and observes `main` with a `ResizeObserver` so sections that grow after loading are counted (spec Edge Cases). Each event schedules one `requestAnimationFrame` measurement; extra events in the same frame are dropped.
2. Measures each section heading's `getBoundingClientRect().top` against a line: the heading's own computed `scroll-margin-top` plus 1px. The current section is the last one whose heading is at or above the line. If none is, it is the first section ("Content"). If the page is scrolled to its end (`innerHeight + scrollY >= scrollHeight - 1`), it is the last section.
3. Exposes `select(id)`, which the menu's links call on click. It sets the current id at once and holds it (ignoring measurements) until no `scroll` event has arrived for 120ms, then measures again.

**Rationale**:

- Reading the line from each heading's `scroll-margin-top` means the place a link scrolls a heading to and the place where it becomes current are the same number, held in one class per heading. If the header or the row's height ever changes, only the classes change.
- "Last heading above the line" is what "the section I'm in" means for sections of very different heights. `IntersectionObserver` reports headings entering and leaving a band, not which one was passed last, and needs bookkeeping to recover that order; for nine headings a measurement per frame is cheap (nine rect reads, no layout writes).
- The hold after a click stops the mark from passing through every section on a smooth scroll (FR-006). The `scrollend` event would be more exact, but Safari's support is recent; a 120ms quiet period works in every browser and covers the instant (reduced-motion) jump too, which fires a single `scroll` event.

**Alternatives considered**: `IntersectionObserver` with a `rootMargin` band. Rejected for the ordering reason above and because it can't apply the end-of-page rule (FR-005) by itself. Updating the address as the current section changes was rejected in the spec (FR-007).

## R-5: Marking the current link

**Decision**: The current link has `aria-current="location"`. Below `xl` it gets a filled chip (`bg-primary text-primary-foreground border-primary`); at `xl` a 2px bar on its leading edge and `font-semibold` (`xl:border-l-2 xl:border-primary`), with the others `xl:border-transparent text-muted-foreground`. When the current id changes below `xl`, the link is scrolled into the row's view with `scrollIntoView({ block: 'nearest', inline: 'nearest', behavior })`, `behavior` being `auto` under `prefers-reduced-motion`.

**Rationale**:

- `aria-current="location"` is the ARIA value for "the current location within a page", and screen readers announce it as "current location" (FR-008, US2).
- A fill or a bar plus weight tells the link apart without colour (US2 scenario 2).
- `block: 'nearest'` keeps the call from scrolling the page vertically, only the row sideways (US1 scenario 9). It is skipped at `xl`, where the list holds every link (or scrolls only at high zoom, handled by `nearest` too).

## R-6: The unsaved-changes mark

**Decision**: `unsaved-changes-context.tsx` gains `useUnsavedSections()`, which returns the set of section ids with unsaved changes. Each report's key is changed to start with the section id it belongs to, so the section is the part before the first `:`:

| Form | Key today | Key after |
|------|-----------|-----------|
| `landing-page-card.tsx` | `landing-page` | `landing-page` |
| `course-catalogue-form.tsx` | `catalogue` | `catalogue` |
| `course-caption-languages-form.tsx` | `caption-languages` | `captions` |
| `course-first-lesson-prompt-form.tsx` | `first-lesson-prompt` | `first-lesson-prompt` |
| `course-price-form.tsx` | `price` | `price` |
| `announcement-form.tsx` | `announcement-<id>`, `announcement-new` | `announcements:<id>`, `announcements:new` |

The menu link for a section in the set shows a small dot (`aria-hidden`) after its label and gets a visually hidden ", unsaved changes" in its text, so its accessible name is "Price, unsaved changes" and still starts with its visible label (UI rules: a link's name contains its visible text).

**Rationale**:

- The provider already holds `dirtySections` for the leave question; the menu reads the same state, so the two can't disagree (FR-009).
- The provider is disabled for a read-only (archived) course (`enabled={!readOnly}`), and none of its forms render then, so no mark shows (US3 scenario 4).
- Changing keys outright is allowed before launch (constitution VII); only these six call sites use them.

**Alternatives considered**: a lookup table from key to section in the menu. Rejected: a new form would have to be added in two places, and forgetting the second would silently drop its mark.

## R-7: What happens to `SectionLinks`

**Decision**: `section-links.tsx` is renamed `section-menu.tsx` (component `SectionMenu`), and keeps everything it does today: the `ready`/`settled` wait, focusing the heading, and scrolling to each hash once (FR-010). It gains the current-section hook (R-4), the marks (R-5, R-6) and the two layouts (R-2, R-3). `route.tsx` moves the sections into the grid and the headings' `scroll-mt-20` becomes `scroll-mt-32 xl:scroll-mt-20`: below `xl`, 64px header + about 45px row + 19px of space; at `xl`, the header only, as today.

**Rationale**: the existing behaviour and its tests (`section-links.test.tsx`, `-route.test.tsx`) carry over; the rename says what the component now is. The address-scroll code calls the hook's `select` for the hash it goes to, so a section opened from its address is marked (spec Edge Cases).

## R-8: Tests

**Decision**:

- **Component tests** (`section-menu.test.tsx`, Vitest + jsdom): jsdom has no layout, so the hook's measurement is tested by stubbing `getBoundingClientRect` on the headings and `scrollY`/`innerHeight`/`scrollHeight` on the window, then firing `scroll`. Cases: first section before any heading passes; the last heading passed wins; end of page marks the last section; a click holds its mark through scroll events until 120ms of quiet (fake timers); exactly one `aria-current`; the unsaved name and dot follow `useUnsavedSections`.
- **Context test**: `unsaved-changes-context` reports `announcements:new` as section `announcements`, and clears it on unmount.
- **e2e**: the scenarios run in Playwright's Desktop Chrome device, 1280px wide, which is exactly where the side menu starts (`xl` is `min-width: 1280px`).
  - `phone-width.e2e.ts`'s course editor step already clicks "Announcements". It is extended to check that, after the jump, the row is still in the viewport and its "Announcements" link has `aria-current="location"`, and that scrolling back to the top marks "Content".
  - `course-price.e2e.ts` gains a step at the default width: go to Price from the menu, scroll to the end of the page, and check the side menu is in the viewport and marks the last section.
  - `unsaved-work.e2e.ts`'s "leaving the editor with a changed price asks first" step checks the menu's link is named "Price, unsaved changes" before it leaves.
  - Each takes a `screenshot()` of the menu, as the UI rules require.
- **(human)**: a screen-reader check of "current location" and "unsaved changes", and a look at 200% zoom.

## R-9: The UI rule

**Decision**: `packages/websites/CLAUDE.md`, under "Links and navigation", gains: "A page long enough for in-page section links keeps them on screen (`sticky`) and marks the section being read with `aria-current="location"`. Scrolling doesn't change the address; using a link does."

**Rationale**: FR-012. The student course page's bar meets the first half and not the second; the rule makes that a known gap rather than a precedent. Fixing it there is out of scope (spec Assumptions).
