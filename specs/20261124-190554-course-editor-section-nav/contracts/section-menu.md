# Contract: `SectionMenu` and `useCurrentSection`

Route-private to the course editor (`packages/websites/instructor-portal/src/routes/_authenticated/my-courses_/$courseId/-components/`). Nothing outside the editor imports them; the student portal's course page is out of scope (spec Assumptions).

## `SectionMenu`

Replaces `SectionLinks` (`section-links.tsx` → `section-menu.tsx`).

```ts
type Section = { id: string; label: string };

function SectionMenu(props: {
  sections: Section[];       // shown sections, in page order
  ready?: boolean;           // as today: hold the address scroll while loading
  settled?: () => boolean;   // as today: asked again just before scrolling
}): JSX.Element;
```

Renders, at every width:

- one `<nav aria-label="Course sections">`, holding one `<ul>` with one router `Link to="." hash={id}` per section;
- on the current section's link, `aria-current="location"`, and on no other;
- on each link whose section is in `useUnsavedSections()`, a dot (`aria-hidden`) and a visually hidden ", unsaved changes", so the accessible name is "<label>, unsaved changes".

Layout:

| Width | `nav` | list | current link |
|-------|-------|------|--------------|
| below 1280px | `sticky top-16`, full width of `main`, under the header, with a bottom border and background | one row, `overflow-x-auto`, links ≥ 24px tall | filled chip; scrolled into the row's view on change |
| 1280px and up | first column of the grid, `sticky top-20`, `max-h-[calc(100dvh-6rem)] overflow-y-auto` | one column | leading 2px bar and semibold text |

Behaviour kept from `SectionLinks` (FR-010):

- When the address's hash changes, and `ready` is true and `settled()` (if given) is true after the commit's effects, it focuses the heading with that `id` (`preventScroll`) and scrolls it into view, smoothly unless reduced motion is asked for. Each hash is scrolled to once.
- New: before that scroll, it calls `select(hash)`, so the section opened from its address is the current one.

## `useCurrentSection`

```ts
function useCurrentSection(ids: string[]): {
  current: string;            // always one of ids (ids[0] when empty measurements)
  select: (id: string) => void;
};
```

- Measures on window `scroll` (passive), `resize`, and `ResizeObserver` on `main`, at most once per animation frame. The rule is in [data-model.md](../data-model.md#current-section).
- Reads each heading by `document.getElementById(id)`; an id with no element is skipped.
- `select(id)` sets `current` at once and ignores measurements until 120ms pass without a `scroll` event, then measures.
- Removes every listener and observer, and cancels any pending frame and timer, on unmount.

## `useUnsavedSections`

Added to `unsaved-changes-context.tsx`.

```ts
function useUnsavedSections(): ReadonlySet<string>;
```

Returns the sections (key prefix before the first `:`) that have at least one dirty report. Returns an empty set outside the provider.

## Headings

Each section heading in `route.tsx` keeps its `id` and `tabIndex={-1}`, and its `scroll-mt-20` becomes `scroll-mt-32 xl:scroll-mt-20`. The current-section rule reads this value back, so it is the one place the offset lives.
