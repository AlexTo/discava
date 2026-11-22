# Implementation Plan: Instructor Portal UX Fixes

**Branch**: `20261123-000428-instructor-portal-ux-fixes` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261123-000428-instructor-portal-ux-fixes/spec.md`, and the findings in [audit.md](./audit.md)

## Summary

This is eleven independent slices of presentation work, in four packages:

- `packages/websites/instructor-portal`
- `packages/common/shadcn`
- `packages/common/web-utils` (no change expected beyond what `apiErrorMessage` already does)
- `packages/e2e`

No API, schema, entity, event handler, construct or stage setting changes. The portal makes the same requests as today, with the same inputs.

The audit's 110 findings come down to a few root causes, most of them repeated across pages. The plan fixes each cause once, where it lives, and puts anything a second portal could use in the shared packages.

**Shared, changed** (`common-shadcn`):

- **`ui/dialog.tsx`:** `DialogContent`'s single column becomes `minmax(0,1fr)` (R-1), and the close button 24px (R-13).
- **`portal-shell.tsx`:** in the shell:
  - breadcrumbs are real (R-3): "Home", plain text for segments with no page, wrapping, 24px targets;
  - `RouteAnnouncer` is mounted (R-4);
  - the phone sidebar closes on navigation (R-6).
- **Hit areas:** `ui/checkbox.tsx`, `ui/radio-group.tsx` and `ui/switch.tsx` get 24px hit areas (R-13).
- **`discussion/post-card.tsx`:** gains `min-w-0` and a `headingLevel` (R-1, R-4).
- **`notification-preferences.tsx`:** errors, retry, labels (R-9, R-13).

**Shared, new** (`common-shadcn`):

- `PendingButton` (R-5)
- `useReturnFocus` (R-6)
- `DiscardChangesDialog` + `useDiscardGuard` (R-8)
- `useUnsavedChangesGuard` (R-8)
- `StatusMessage` (R-14)
- `LoadingState` (R-4)

Their promises are in [contracts/shared-components.md](./contracts/shared-components.md).

**Instructor portal:**

- row layouts (R-2), long content (R-12), titles and headings (R-4);
- focus after each action (R-6, R-7), typed work (R-8), errors and validation (R-9);
- views in the address (R-10), the course editor's order and section links (R-11);
- names (R-13), announcements (R-14).

**Rules:** new checks in `packages/websites/CLAUDE.md`, drafted in [contracts/ui-rules.md](./contracts/ui-rules.md).

What the code showed that the audit could not:

1. **One dialog frame causes every dialog overflow.** `DialogContent` is a grid with no column template, so its `auto` column grows to its widest unbreakable content. A collapsed question's `truncate` summary is the whole prompt on one line (R-1).
2. **`expectNoSidewaysScroll` can pass while controls are unreachable.** The module card is `overflow-hidden`, so its non-wrapping rows clip instead of overflowing the document. The e2e suite needs an on-screen check for controls (R-2, R-15).
3. **Breadcrumbs could never have hidden dead links.** `PortalShell` never passes `availableRoutes`. Even if it did, `matchRoute` tests the current location, not a route's existence. An unmatched crumb's `href="#"` goes home through `<base href="/">` (R-3).
4. **`RouteAnnouncer` and `usePageTitle` already exist** from the student-portal feature. Only the student portal uses them (R-4).
5. **Most focus losses have one cause.** A focused button set to `disabled` while its request runs sends focus to `<body>` (R-5). Most of the rest are a control unmounted by its own action, or a dialog with no trigger (R-6).
6. **Cancel and Escape take different paths.** Cancel calls `setOpen(false)`, which skips the `onOpenChange` reset (R-8).
7. **The discard guard exists, privately.** The quiz builder and video-questions dialogs have a confirmation and `beforeunload`, which other dialogs and the page can reuse once shared (R-8).
8. **`apiErrorMessage` already handles network faults.** Four call sites bypass it, and the upload helper hides the browser's `TypeError` behind a plain `Error` (R-9).
9. **`ErrorAlert` already has `onRetry`.** The instructor portal hand-builds "Retry" buttons beside it in nine places (R-9).

## Technical Context

**Language/Version**: TypeScript; React 19 + Vite portals; pnpm/Nx monorepo

**Primary Dependencies**:

- TanStack Router (`useBlocker`, `validateSearch`, `Link` with `hash`, `notFoundComponent`) and TanStack Query
- `@discava/common-shadcn` (shadcn/ui on Radix, Tailwind)
- dnd-kit (accessibility announcements)
- recharts
- react-pdf

No new dependency.

**Storage**: N/A. No record is read or written in a new way

**Testing**: vitest with Testing Library (`common-shadcn`, `instructor-portal`); Playwright e2e in `packages/e2e`

**Target Platform**: browsers, at 375px and 1440px wide; `pnpm dev` locally; CloudFront when deployed

**Project Type**: web application (frontend only for this feature)

**Performance Goals**: no added request. Layout is CSS. The one measurement (the PDF preview's container width) is read in an effect through `ResizeObserver`, never during render

**Constraints**:

- same requests, same inputs, same moments (FR-031);
- shared fixes land in shared packages (FR-033);
- text-only buttons (FR-032);
- desktop layout of rows and dialogs unchanged apart from long-content fixes (US1 scenario 9);
- shadcn `ui/` files change only where a rule needs it, and the pull request says so (`packages/common/shadcn/CLAUDE.md`)

**Scale/Scope**: about 90 instructor-portal source files touched across 24 routes and their components, 6 shared pieces added, and 6 shared files changed. 11 user stories, each one pull request; US5 and US7 may split by area (see Delivery)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | No backend or infrastructure change |
| II. Generators first | Pass | No project or component is scaffolded. Files are added to existing packages; no shadcn registry item is added. Changes to `ui/` files are the minimum a rule needs, named in each pull request |
| III. Everything runs locally | Pass | Every story is exercised under `pnpm dev`; the audit itself ran there |
| IV. Layered tests | Pass, planned | Component tests for each shared piece and each changed screen. E2e: instructor cases in `phone-width.e2e.ts`, plus extensions to `breadcrumbs`, `quiz` and a views-in-the-address scenario. No invariant work: see the impact check |
| V. Single-table via ElectroDB | Pass | Not touched |
| VI. Secure by default | Pass | Not touched. Error wording hides internal phrases and adds none; the not-found page reveals nothing a 404 didn't |
| VII. Change freely before launch | Pass | The "Give feedback" card is removed outright. Changed accessible names are changed, not aliased |
| VIII. Repo conventions | Pass | Shared UI in `common-shadcn`; route-private code in `-components/`, hooks in `hooks/`; kebab-case files; text-only buttons; e2e `screenshot()` on changed screens |

No violations, so Complexity Tracking is empty.

**Impact check (constitution IV).** This feature writes no shared record and reads none in a new way.

- "Try again" repeats queries the pages already make.
- The views read from the address send the same inputs the on-screen controls send today.
- The unsaved-changes guards block navigation in the browser only.

No invariant is added or extended, and `entity-writers.json` does not change.

**Tests that change meaning (constitution IV, "tests are a specification").** These existing expectations describe behaviour this spec changes on purpose. Each is named in a task.

| Test | What it asserts today | Change, and the requirement behind it |
|------|----------------------|---------------------------------------|
| `instructor-portal` `-index.test.tsx`, `dashboard/-route.test.tsx`, `dashboard_/$courseId/-route.test.tsx`, `-components/quiz-panel.test.tsx` | a button named "Retry" refetches | it is `ErrorAlert`'s "Try again" (FR-022) |
| `instructor-portal` `course/course-modules.test.tsx` | a button named "Edit module 1" | it is named by the module's title (FR-029) |
| `instructor-portal` `content-items/lesson-content-items-row.test.tsx`, e2e `video-questions.e2e.ts` | a button named "Questions for <title>" | it is "Questions (N) for <title>" (FR-029) |
| `instructor-portal` `lesson/free-preview-button.test.tsx`, e2e `helpers/free-preview.ts` | separate "Make free preview" and "Remove free preview" buttons swap | one button whose label changes. The names stay, so the helpers keep working; assertions about the button being replaced change (FR-014) |
| `instructor-portal` `-index.test.tsx` | the home page shows "Give feedback" (if asserted) | the card is gone (FR-011, clarification) |
| `instructor-portal` tests that assert a button is `disabled` while pending | `toBeDisabled()` | `toHaveAttribute('aria-disabled', 'true')`, focus kept (FR-013) |
| `instructor-portal` `course/course-price-form.test.tsx`, `course/course-first-lesson-prompt-form.test.tsx` | after a failed save the field shows the saved value (if asserted) | it keeps what was typed (FR-018) |

## Project Structure

### Documentation (this feature)

```text
specs/20261123-000428-instructor-portal-ux-fixes/
├── audit.md             # The 110 findings, by area and ID
├── plan.md              # This file
├── research.md          # Decisions R-1 to R-15
├── data-model.md        # Browser-side state of the shared pieces and the address
├── quickstart.md        # How to check each story
├── contracts/
│   ├── shared-components.md   # PendingButton, useReturnFocus, DiscardChangesDialog/useDiscardGuard,
│   │                          # useUnsavedChangesGuard, StatusMessage, LoadingState; PortalShell,
│   │                          # DialogContent, controls, PostCard changes
│   ├── page-titles.md         # The title of every instructor-portal page
│   ├── url-state.md           # The search params of My Courses, questions, earnings
│   └── ui-rules.md            # The checks added to packages/websites/CLAUDE.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
packages/common/shadcn/src/
├── components/
│   ├── ui/dialog.tsx                  # minmax(0,1fr) column; 24px close button
│   ├── ui/checkbox.tsx, ui/radio-group.tsx, ui/switch.tsx   # 24px hit area
│   ├── portal-shell.tsx (+ test)      # Home crumb, routeExists, text crumbs, RouteAnnouncer, sidebar close
│   ├── pending-button.tsx (+ test)    # new
│   ├── discard-changes-dialog.tsx (+ test)   # new (moved out of the quiz builder)
│   ├── status-message.tsx (+ test)    # new
│   ├── loading-state.tsx (+ test)     # new
│   └── notification-preferences.tsx (+ test)
├── discussion/post-card.tsx (+ test)  # min-w-0, headingLevel
└── hooks/
    ├── use-return-focus.ts (+ test)   # new
    ├── use-discard-guard.ts (+ test)  # new
    └── use-unsaved-changes-guard.ts (+ test)  # new

packages/websites/instructor-portal/src/
├── main.tsx, routes/signin.tsx, components/app-layout.tsx, components/create-course-dialog.tsx
├── lib/put-file-with-progress.ts
└── routes/_authenticated/
    ├── route.tsx (notFoundComponent), index.tsx, profile.tsx, settings/notifications.tsx
    ├── dashboard/route.tsx, dashboard_/$courseId/route.tsx + -components/*
    ├── earnings/route.tsx + -components/*
    ├── my-courses/route.tsx
    ├── my-courses_/$courseId/route.tsx + -components/{section-links.tsx (new), course/*, module/*,
    │   lesson/*, content-items/**, assignment/*, announcements/*, sortable-list.tsx,
    │   rich-text-editor.tsx, math-popover.tsx}
    └── my-courses_/$courseId_/{questions/**, reviews.tsx, -components/*, assignments/**}
    (tests beside each file)

packages/e2e/src/
├── scenarios/phone-width.e2e.ts             # instructor cases
├── scenarios/{breadcrumbs,quiz}.e2e.ts      # extended
├── scenarios/instructor-views.e2e.ts        # new: views in the address
└── helpers/{viewport,free-preview,video-questions}.ts   # expectDialogFits, expectOnScreen; renamed controls

packages/websites/CLAUDE.md                  # new checks (contracts/ui-rules.md)
```

**Structure Decision**: No new package.

- **Shared:** UI goes in `common-shadcn` (components and its `hooks/`).
- **Instructor portal:** everything only it uses stays there, route-private code in `-components/`.
- **Other portals:** the student and admin portals aren't edited. They gain the shared changes by importing them; the admin portal gains `RouteAnnouncer` and real breadcrumbs through `PortalShell`.

**Delivery**: One pull request per user story, in any order, after Phase 2. US1, US2 and US3 are the P1 slice.

- **Phase 2 (foundations) goes first:** it lands the shared pieces with their tests, and the e2e helpers.
- **US5 and US7 are large.** Each may land as two pull requests:
  - course editor and dialogs;
  - the other pages.

  Each pull request completes its own scenarios.
- **Pairs that touch the same files are easier in sequence:**
  - US1 before US10 (`course-modules.tsx`, the editor's `route.tsx`);
  - US4 before US7 (the analytics and submission routes' error branches).
- **US11 can merge first,** so that the other slices are reviewed against the new checks.

## Complexity Tracking

No violations.
