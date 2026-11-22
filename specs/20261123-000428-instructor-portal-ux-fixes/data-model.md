# Data Model: Instructor Portal UX Fixes

This feature stores nothing and changes no entity, index, schema or request. The core table, the search index and every API contract are as they were.

What it defines is browser-side state: what a few shared pieces hold, and what three pages keep in the address. None of it is persisted beyond the address bar.

## `PendingButton`

| State | Values | Effect |
|-------|--------|--------|
| `pending` | `false` | an ordinary `Button` |
| `pending` | `true` | `aria-disabled="true"` and dimmed; it stays focusable and in the tab order; clicks and submits are ignored; it shows `pendingLabel` |

A truly unavailable action still uses `disabled` (no reason to focus it). Its reason is shown as text beside it (FR-023).

## Dialog dirty state and `useDiscardGuard`

| Event | `dirty` false | `dirty` true |
|-------|---------------|--------------|
| Cancel | closes and resets | closes and resets (Cancel is deliberate) |
| Close (X), Escape, click outside | closes and resets | opens "Discard unsaved changes?". **Discard changes** closes and resets; **Keep editing** returns to the dialog with focus where it was |
| Save succeeds | closes | closes |
| Save fails | stays open, input kept | stays open, input kept, still dirty |

`dirty` means something in the dialog differs from its saved state. This covers:

- a field changed;
- an upload finished but not yet attached;
- a quiz with any change, as the quiz builder already tracks.

## `useUnsavedChangesGuard` (course editor)

| State | Leaving by an in-app link | Closing or reloading the tab |
|-------|---------------------------|------------------------------|
| no section dirty | leaves | leaves |
| one or more sections dirty | asks "Leave without saving?" (**Leave** / **Stay**) | the browser's own leave question |

The editor's settings sections each report their dirty flag to one context; the route reads the union. An archived course reports none: nothing can be edited.

## `useReturnFocus`

| Event | Effect |
|-------|--------|
| dialog opens | records the focused element |
| dialog closes | focuses the recorded element if it is still in the document; otherwise the caller's fallback (a neighbour, or the page's `h1`) |

## `StatusMessage`

| Event | Effect |
|-------|--------|
| mount | an empty `role="status"` region exists |
| `message` set | the text is announced once |
| a few seconds later | cleared (no announcement for the clearing) |
| the same message set twice in a row | announced again (the region is cleared first) |

## Views in the address

See [contracts/url-state.md](./contracts/url-state.md) for the parameters. The rules common to all three pages:

- **Defaults:** a default value is left out of the address.
- **Invalid values:** an invalid value falls back to the default, and the address is corrected with `replace`.
- **History entries:**
  - typing in a search box replaces the current history entry;
  - choosing a tab, filter, lesson or period adds one.
- **On screen:** the controls show the address's values, Back and Forward included.

## The course editor's sections

| Section id | Heading | Shown when |
|------------|---------|------------|
| `content` | Course content | always |
| `landing-page` | Landing page | not archived |
| `catalogue` | Catalogue details | not archived |
| `captions` | Caption languages | caption translation is on for the stage |
| `certificates` | Certificates | always |
| `first-lesson-prompt` | First-lesson prompt | not archived |
| `price` | Price | not archived |
| `announcements` | Announcements | always (a draft shows the "publish first" line) |
| `archived` | Archived | the course has archived modules or lessons |

The section links show one link per section on the page, in this order. The checklist's "Add it" links target `landing-page`, `course-image` (inside the header) and `preview-video` (inside `landing-page`).

## Breadcrumb

| Field | Rule |
|-------|------|
| `text` | "Home" for the root, a label from `segmentLabels`, or a title set with `useBreadcrumbLabel`. A raw segment shows only if none of these exist |
| `href` | set only when a route exists for the path, so the crumb is a link; otherwise unset, and the crumb is rendered as text |
