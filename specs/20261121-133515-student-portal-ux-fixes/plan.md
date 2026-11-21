# Implementation Plan: Student Portal UX Fixes

**Branch**: `20261121-133515-student-portal-ux-fixes` | **Date**: 2026-11-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261121-133515-student-portal-ux-fixes/spec.md`

## Summary

Nine independent slices of presentation work in three packages: `packages/websites/student-portal`, `packages/common/shadcn` and `packages/common/web-utils`. No API, schema, entity, event handler, construct or stage setting changes, and the portal makes the same requests as today.

Most defects have one small root cause each. The plan fixes the cause where it lives, and puts anything a second portal could use in the shared packages:

- **Shared, new** (`common-shadcn`): a `ResponsivePanel` that is a closed disclosure below the desktop breakpoint and plain content above it (course outline, filter panel); `usePageTitle` and `RouteAnnouncer` (titles and focus on navigation); an `onRetry` on `ErrorAlert`.
- **Shared, changed**: `QuizCard` and its phases (focus, announcement, numbered navigator, attempt line, icon size); `apiErrorMessage` in `common-web-utils` (network and server faults); `UserMenu` is used as it is, through its existing `items`.
- **Student portal**: layout classes, in-page links, the top bar, catalogue results, course card, instructor profile, category search box, sign-in page.
- **Rules**: a new `packages/websites/CLAUDE.md`, a short `packages/common/shadcn/CLAUDE.md` that points to it, and one line in the root `CLAUDE.md` and in `CONTRIBUTING.md`. The text is drafted in [contracts/ui-rules.md](./contracts/ui-rules.md).

What the code showed that the audits could not:

1. **The lesson layout breaks because a grid track cannot shrink.** `CoursePlayerLayout` (`student-portal/src/routes/learn/$courseId/-components/course-player.tsx`) lays out `lg:grid-cols-[1fr_2fr]`. A `1fr` track is `minmax(auto, 1fr)`, and the outline's titles are `truncate` (no wrapping), so the track's minimum is the longest title. `min-w-0` on the `aside` and `minmax(0,…)` tracks fix both widths: measured 352px/704px at 1440px, and no overflow from the page body at 375px (research R-1).
2. **In-page links go home because of `<base href="/">`.** `student-portal/index.html` sets it, so `href="#modules"` resolves to `/#modules`. The base stays (asset paths and the other portals rely on the same template); the links become router `Link`s to the current route with `hash`, which the router scrolls to (research R-2). Five places: the course page's tab bar and "N modules" card, the lesson's step links, and the home footer's two links.
3. **`UserMenu` already takes extra entries.** `UserMenuProps.items` exists, so moving "My Learning" and "Instructor" into it on a phone needs no change to the shared component, only to `site-layout.tsx` (research R-3).
4. **The filter panel is drawn from the response.** `CatalogueResults` reads `facets` from the first page of the search query, and a new filter is a new query key with no data, so the panel unmounts. `placeholderData: keepPreviousData` keeps the last answer on screen: the same request, made at the same moment (research R-4).
5. **The quiz card swaps whole subtrees.** `QuizCard` renders one of four phase components, so the focused button is removed with its phase. Focus management belongs in `QuizCard`, which owns the phase, not in each phase (research R-5).
6. **`apiErrorMessage` trusts any message.** It returns `error.message` unless it is empty, equals the code, or looks like JSON. A network failure's message is the browser's ("Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed"), and a server fault's is tRPC's ("Output validation failed"). Both need a rule of their own, and three call sites bypass the helper (research R-6).
7. **`Avatar`'s `size` beats a class.** `data-[size=lg]:size-10` outranks `size-28`, so the profile's picture is 40px. The profile drops `size` (research R-8).
8. **Nothing sets titles.** Only `instructors/$handle.tsx` assigns `document.title`, in an effect with no cleanup. The router has no title or focus handling configured (research R-7).
9. **The e2e suite has one desktop project.** `packages/e2e/playwright.config.ts` runs "Desktop Chrome" only. A scenario can set its own viewport with `test.use({ viewport })`, so phone-width checks need no new project (research R-9).
10. **Nested `CLAUDE.md` files are the project's way to scope instructions.** The root file says they load "only when you work in that directory". Neither `packages/websites/` nor `packages/common/shadcn/` has one (research R-10).

## Technical Context

**Language/Version**: TypeScript, React 19 + Vite portals, pnpm/Nx monorepo

**Primary Dependencies**: TanStack Router and Query, `@discava/common-shadcn` (shadcn/ui on Radix, Tailwind), `@discava/common-web-utils`, lucide-react. No new dependency

**Storage**: N/A. No record is read or written in a new way

**Testing**: vitest with Testing Library per project (`common-shadcn`, `common-web-utils`, `student-portal`), Playwright e2e in `packages/e2e`

**Target Platform**: browsers, at 375px and 1440px wide; `pnpm dev` locally; CloudFront when deployed

**Project Type**: web application (frontend only for this feature)

**Performance Goals**: no added request; no layout read in render (layout is CSS, not measurement)

**Constraints**: same requests with the same inputs at the same moments (FR-028); shared fixes land in shared packages (FR-029); text-only buttons (FR-030); no change to the 1440px top bar (US3 scenario 5)

**Scale/Scope**: about 20 source files changed, 3 shared pieces added, 2 instruction files added; 9 user stories, each one pull request

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | No backend or infrastructure change |
| II. Generators first | Pass | No project or component is scaffolded: files are added to existing packages. `ResponsivePanel` composes the existing `Collapsible`; no shadcn registry item is added |
| III. Everything runs locally | Pass | Everything is exercised under `pnpm dev`. Nothing depends on a deployed stage |
| IV. Layered tests | Pass, planned | Component tests for each shared piece and each changed page; unit tests for `apiErrorMessage` and the title helper; e2e: a new phone-width scenario and extensions to `learn`, `quiz` and `search`. No invariant work: see the impact check |
| V. Single-table via ElectroDB | Pass | Not touched |
| VI. Secure by default | Pass | Not touched. Error wording hides internal phrases and adds none |
| VII. Change freely before launch | Pass | The dead "Terms" link is removed outright; no redirect, alias or fallback is added |
| VIII. Repo conventions | Pass | Shared UI in `common-shadcn`, non-UI in `common-web-utils`, route-private code in `-components/`, kebab-case files, text-only buttons, e2e `screenshot()` on changed screens |

No violations, so Complexity Tracking is empty.

**Impact check (constitution IV).** This feature writes no shared record and reads none in a new way. It makes no new request: `keepPreviousData` and "Try again" reuse queries the pages already make, with the same inputs. No invariant is added or extended, and `entity-writers.json` does not change.

**Tests that change meaning (constitution IV, "tests are a specification").** Four existing expectations describe behaviour this spec changes, and each is named in a task:

| Test | What it asserts today | Change, and the requirement behind it |
|------|----------------------|---------------------------------------|
| `packages/e2e/src/helpers/student-portal.ts` `takeQuiz` | clicks a button named "Submit" | the button is "Submit answers" (FR-019) |
| `common-shadcn` `quiz-card.test.tsx` | question navigator buttons found by "Question N" label with no text | they keep that accessible name and gain a visible number (FR-017); assertions on class names, if any, are updated |
| `student-portal` `routes/instructors/-instructor-profile.test.tsx` "sets the document title to the display name" | `document.title` is `'Gil Strang'` | it is `'Gil Strang · Discava'` (FR-011, T036) |
| `student-portal` course-card and e2e helpers that find a course by `Preview <title>` | the link's accessible name is "Preview <title>" | the name contains the visible text (FR-020); `openCourse` already finds the course by its title |

## Project Structure

### Documentation (this feature)

```text
specs/20261121-133515-student-portal-ux-fixes/
├── plan.md              # This file
├── research.md          # Decisions R-1 to R-11
├── data-model.md        # States of the shared UI pieces (no stored data)
├── quickstart.md        # How to check each story
├── contracts/
│   ├── shared-components.md   # ResponsivePanel, usePageTitle, RouteAnnouncer, ErrorAlert, QuizCard, apiErrorMessage
│   ├── page-titles.md         # The title of every student-portal page
│   └── ui-rules.md            # The text for packages/websites/CLAUDE.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
packages/common/shadcn/src/
├── components/
│   ├── responsive-panel.tsx (+ test)        # new: closed disclosure below lg, plain above
│   ├── route-announcer.tsx (+ test)         # new: focus the main heading after navigation
│   ├── error-alert.tsx (+ test)             # onRetry, retryLabel
│   ├── quiz-card.tsx (+ test)               # focus on phase change; passes attempt numbers
│   ├── quiz-card-phases.tsx                 # numbered navigator, "Submit answers", attempt line, live result
│   ├── quiz-question-screen.tsx             # focus target
│   └── quiz-result-questions.tsx            # icon keeps its size
└── hooks/
    └── use-page-title.ts (+ test)           # new

packages/common/web-utils/src/
├── api-errors.ts (+ test)                   # network and server-fault sentences
└── page-title.ts (+ test)                   # new: pageTitle(...parts)

packages/websites/student-portal/src/
├── components/
│   ├── site-layout.tsx                      # phone top bar; RouteAnnouncer
│   ├── site-search.tsx, site-search-suggestions.tsx
│   ├── catalogue-results.tsx, catalogue-filters.tsx
│   └── course-card.tsx
├── routes/
│   ├── index.tsx, -components/catalogue.tsx, -components/signed-in-home.tsx
│   ├── search/index.tsx, category/$slug.tsx, instructors/$handle.tsx, signin/index.tsx
│   └── learn/$courseId/-components/
│       ├── course-page.tsx, course-player.tsx, lesson-page.tsx, course-home.tsx
│       ├── start-course.tsx, enrolment-actions.tsx, quiz-item.tsx, content-item.tsx
└── (tests beside each file)

packages/e2e/src/
├── scenarios/phone-width.e2e.ts             # new
├── scenarios/{learn,quiz,search,public-landing-page}.e2e.ts   # extended
└── helpers/{student-portal,viewport}.ts     # takeQuiz label; expectNoSidewaysScroll

packages/websites/CLAUDE.md                  # new: the UI rules
packages/common/shadcn/CLAUDE.md             # new: pointer + shared-component rules
CLAUDE.md, CONTRIBUTING.md                   # one line each
```

**Structure Decision**: no new package. Shared UI goes in `common-shadcn` (components and its existing `hooks/`), shared non-UI in `common-web-utils` as per-module files, and everything only the student portal uses stays in it. The instructor and admin portals are not edited; they pick up the `QuizCard`, `ErrorAlert` and `apiErrorMessage` changes by importing them.

**Delivery**: one pull request per user story, in any order. US1, US2 and US3 are the P1 slice. Two pairs touch the same file and are easier in sequence: US1 before US7 (`course-player.tsx`), and US4 before US8 (`catalogue-results.tsx`, `course-card.tsx`). US9 can merge first, so the other slices are reviewed against the written rules.

## Complexity Tracking

No violations.
