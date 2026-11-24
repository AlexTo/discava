# Data Model: Course Editor Section Menu

This feature stores nothing and changes no entity, index, schema or request. The core table, the search index and every API contract are as they were (FR-011).

What it defines is browser-side state on the course editor page. None of it is persisted, and only the section a link was used for goes in the address, as today.

## Section

| Field | Values | Source |
|-------|--------|--------|
| `id` | `content`, `landing-page`, `catalogue`, `captions`, `certificates`, `first-lesson-prompt`, `price`, `announcements`, `archived` | fixed; also the heading's `id` and the address after `#` |
| `label` | "Content", "Landing page", "Catalogue", "Captions", "Certificates", "First-lesson prompt", "Price", "Announcements", "Archived" | fixed |
| shown | yes / no | worked out in `route.tsx`, as today |

When a section is shown:

| Section | Shown when |
|---------|-----------|
| Content, Certificates, Announcements | always |
| Landing page, Catalogue, First-lesson prompt, Price | the course isn't archived |
| Captions | the stage's caption translation isn't off |
| Archived | the course has archived modules, lessons or items |

## Current section

One `id` from the shown sections, held by `useCurrentSection` ([research R-4](./research.md#r-4-how-the-current-section-is-found)).

| Event | New current section |
|-------|---------------------|
| page loads with no `#` | `content` |
| page loads with `#<id>`, once the scroll there runs | `<id>` |
| a menu link is used | that link's `id`, at once; held until 120ms pass with no scroll |
| the page scrolls (not held) | the last section whose heading's top is at or above its `scroll-margin-top` + 1px; `content` if none; the last shown section if the page is at its end |
| the window resizes, or the page's height changes (not held) | measured again by the rule above |
| the shown sections change (a section's data arrives) | measured again; if the current `id` is no longer shown, the rule above picks one |

Invariant: while the menu shows, exactly one link has `aria-current="location"`.

## Unsaved sections

The set of section ids with unsaved changes, read from `UnsavedChangesProvider` with `useUnsavedSections()` ([research R-6](./research.md#r-6-the-unsaved-changes-mark)). A report key's section is the part before its first `:`.

| Report key | Section |
|------------|---------|
| `landing-page` | `landing-page` |
| `catalogue` | `catalogue` |
| `captions` | `captions` |
| `first-lesson-prompt` | `first-lesson-prompt` |
| `price` | `price` |
| `announcements:new`, `announcements:<announcementId>` | `announcements` |

A section leaves the set when every key under it reports clean or unmounts. The provider is off for an archived course, so the set is then always empty.
