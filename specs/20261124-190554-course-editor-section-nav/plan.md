# Implementation Plan: Course Editor Section Menu

**Branch**: `20261124-190554-course-editor-section-nav` | **Date**: 2026-11-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261124-190554-course-editor-section-nav/spec.md`

## Summary

The course editor's row of section links scrolls off the screen on the first jump, and none of the links shows where the instructor is. This plan replaces it with a section menu that stays on screen and marks the current section:

- **From 1280px:** a sticky list in a column beside the sections.
- **Below 1280px:** the same row of links as today, stuck under the portal's header.

The change is presentation only, in two packages:

- `packages/websites/instructor-portal`: the course editor route and its route-private components;
- `packages/e2e`: three existing scenarios gain steps.

The portal UI rules (`packages/websites/CLAUDE.md`) gain one rule. No API, schema, entity, event handler, construct or stage setting changes, and the editor makes the same requests as today.

What changes, by file (paths under `packages/websites/instructor-portal/src/routes/_authenticated/my-courses_/$courseId/`):

- **`-components/section-links.tsx` → `-components/section-menu.tsx`:** keeps the address-scroll behaviour, and adds the two layouts, the current-section mark and the unsaved mark ([research R-2, R-3, R-5, R-7](./research.md)).
- **`-components/use-current-section.ts` (new):** works out the current section from the headings' positions, with a hold after a click ([R-4](./research.md#r-4-how-the-current-section-is-found)).
- **`-components/course/unsaved-changes-context.tsx`:** adds `useUnsavedSections()`. Two forms' report keys change to start with their section's id ([R-6](./research.md#r-6-the-unsaved-changes-mark)).
- **`route.tsx`:** the sections below the header card go into a grid with the menu from `xl`, and the wrapper widens at `xl`. The headings' `scroll-mt-20` becomes `scroll-mt-32 xl:scroll-mt-20`, and so do those in `course-first-lesson-prompt-form.tsx` and `archived-section.tsx`.

The interfaces are in [contracts/section-menu.md](./contracts/section-menu.md), and the state and its rules in [data-model.md](./data-model.md).

What the code showed:

1. **The unsaved state already exists, per form.** `UnsavedChangesProvider` holds a set of dirty keys for its leave question. Its keys are almost section ids already; only captions (`caption-languages`) and announcements (`announcement-<id>`) differ ([R-6](./research.md#r-6-the-unsaved-changes-mark)).
2. **The window scrolls, and nothing above the editor clips.** `sticky` works with no script. The student course page already has a `sticky top-16` bar under the same header ([R-1](./research.md#r-1-where-the-editor-scrolls-and-whether-sticky-works-there)).
3. **The desktop e2e width is exactly 1280px.** Playwright's Desktop Chrome device is 1280×720, so every editor scenario now runs with the side menu, and `phone-width.e2e.ts` runs with the row.
4. **Three headings carry the scroll offset outside `route.tsx`.** `course-first-lesson-prompt-form.tsx` and `archived-section.tsx` render their own `h2` with `scroll-mt-20`, and `-route.test.tsx` asserts the class.

## Technical Context

**Language/Version**: TypeScript; React 19 + Vite portal; pnpm/Nx monorepo

**Primary Dependencies**: TanStack Router (`Link` with `hash`, `useRouterState`), TanStack Query (`useIsFetching`, as today), Tailwind via `@discava/common-shadcn`. No new dependency.

**Storage**: N/A. No record is read or written in a new way

**Testing**: vitest with Testing Library and jsdom in `instructor-portal`; Playwright e2e in `packages/e2e`

**Target Platform**: browsers, at 375px and 1280–1440px wide; `pnpm dev` locally; CloudFront when deployed

**Project Type**: web application (frontend only for this feature)

**Performance Goals**: no added request. Scroll handling reads nine heading rects at most once per animation frame, writes no layout, and sets React state only when the current section changes

**Constraints**:

- same requests, same inputs (FR-011);
- the address changes only on a link or Back/Forward (FR-007);
- one "Course sections" landmark at every width, so existing locators keep working ([R-3](./research.md#r-3-layout-below-1280px));
- no sideways page scroll at 375px; links ≥ 24px; motion honours `prefers-reduced-motion` (UI rules)

**Scale/Scope**: one route, about 8 source files and their tests, 3 e2e scenarios, 1 rule. 3 user stories; delivered as three pull requests (see Delivery)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | No backend or infrastructure change |
| II. Generators first | Pass | No project or component is scaffolded; files are added to an existing route's `-components/` |
| III. Everything runs locally | Pass | Exercised under `pnpm dev` like any portal change |
| IV. Layered tests | Pass, planned | Component tests for the hook, the menu and the context. E2e: `phone-width`, `course-price` and `unsaved-work` gain steps. No invariant work: see the impact check |
| V. Single-table via ElectroDB | Pass | Not touched |
| VI. Secure by default | Pass | Not touched |
| VII. Change freely before launch | Pass | `SectionLinks` is renamed and two report keys change outright, with no aliases |
| VIII. Repo conventions | Pass | Route-private code in `-components/`; kebab-case files; no new buttons; e2e `screenshot()` of the menu at both layouts; the new rule goes in `packages/websites/CLAUDE.md` |

No violations, so Complexity Tracking is empty.

**Impact check (constitution IV).** This feature writes no shared record and reads none in a new way. The menu reads browser state only: heading positions and the editor's unsaved-changes set. No invariant is added or extended, and `entity-writers.json` does not change.

**Tests that change meaning (constitution IV, "tests are a specification").** These existing expectations describe behaviour this spec changes on purpose. Each is named in a task.

| Test | What it asserts today | Change, and the requirement behind it |
|------|----------------------|---------------------------------------|
| `instructor-portal` `-components/section-links.test.tsx` | `SectionLinks` renders the links and scrolls to a hash once | moves to `section-menu.test.tsx` against `SectionMenu`; every existing case is kept, and the new cases are added (FR-010) |
| `instructor-portal` `-route.test.tsx` ("links to the sections on the page") | each linked heading has the class `scroll-mt-20` | it has `scroll-mt-32` and `xl:scroll-mt-20` (FR-004) |

## Project Structure

### Documentation (this feature)

```text
specs/20261124-190554-course-editor-section-nav/
├── spec.md
├── plan.md              # This file
├── research.md          # Phase 0: decisions R-1 to R-9
├── data-model.md        # Phase 1: browser-side state and its rules
├── quickstart.md        # Phase 1: checking it by hand
├── contracts/
│   └── section-menu.md  # Phase 1: SectionMenu, useCurrentSection, useUnsavedSections
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/websites/CLAUDE.md                                   # + the section-menu rule (R-9)

packages/websites/instructor-portal/src/routes/_authenticated/my-courses_/$courseId/
├── route.tsx                                                 # grid at xl, wider wrapper, heading offsets
├── -route.test.tsx                                           # heading offset assertion
└── -components/
    ├── section-menu.tsx                                      # renamed from section-links.tsx
    ├── section-menu.test.tsx                                 # renamed from section-links.test.tsx, + new cases
    ├── use-current-section.ts                                # new
    ├── use-current-section.test.tsx                          # new
    ├── announcements/announcement-form.tsx                   # report key
    └── course/
        ├── unsaved-changes-context.tsx                       # + useUnsavedSections
        ├── unsaved-changes-context.test.tsx                  # + useUnsavedSections cases
        ├── course-caption-languages-form.tsx                 # report key
        ├── course-first-lesson-prompt-form.tsx               # heading offset
        └── archived-section.tsx                              # heading offset

packages/e2e/src/scenarios/
├── phone-width.e2e.ts                                        # row stays, marks the section
├── course-price.e2e.ts                                       # side menu stays, marks the section
└── unsaved-work.e2e.ts                                       # "Price, unsaved changes"
```

**Structure Decision**: Everything stays route-private to the course editor. The hook could serve the student course page's bar, but only one portal uses it today, so by the repository's rule it stays beside its one user. Moving it to `common-shadcn` is the first step of a later change that adopts it there.

## Delivery

Three pull requests, each from `main`, as [tasks.md](./tasks.md) groups them:

1. **Foundations + US1: the menu stays and marks the current section.** The rename, the hook, the menu's two layouts, the current mark, the heading offsets, the rule, the component tests, and the `phone-width` and `course-price` e2e steps. This is the fix for the reported problem, and is useful alone.
2. **US2: told, not only shown.** Focus rings, a mark that doesn't rely on colour, focus order, reduced motion for the row's scroll, and a keyboard e2e step. Needs PR 1.
3. **US3: the unsaved mark.** `useUnsavedSections`, the two key changes, the mark, its tests, and the `unsaved-work` e2e step. Needs PR 1's menu, not PR 2.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None.
