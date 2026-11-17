# Implementation Plan: Real Courses on the Instructor Home Page

**Branch**: `20261116-001229-instructor-home-real-courses` | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261116-001229-instructor-home-real-courses/spec.md`

## Summary

Replace the instructor portal home page's hard-coded sample data with the signed-in instructor's real draft and published courses, read through the existing `course.listByInstructor` query (the one My Courses already uses). Remove sections with no real data behind them. Add empty, loading and error states. Frontend-only: no new API, entity, index or infrastructure.

## Technical Context

**Language/Version**: TypeScript, React 19 with Vite and TanStack Router (instructor-portal)

**Primary Dependencies**: TanStack Query via the existing `useCoreApi` tRPC client, `react-oidc-context` for the signed-in user, shared `@discava/common-shadcn` components

**Storage**: N/A. Reads existing `courseInstructor` and `course` records through core-api; writes nothing.

**Testing**: Vitest + Testing Library component tests (pattern: `my-courses/-route.test.tsx`); Playwright scenario in `packages/e2e`

**Target Platform**: Browser (instructor portal)

**Project Type**: Web application (one portal route change)

**Performance Goals**: Courses visible within 3 seconds (SC-003); one list request on page open

**Constraints**: Archived courses are filtered client-side (the API has no status filter); the list is requested with the same limit My Courses uses (100)

**Scale/Scope**: One route component, one small shared course-card helper if reuse with My Courses is clean

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Note |
|-----------|--------|------|
| I. AWS-native serverless | Pass | No backend change |
| II. Generators first | Pass | No new project or component; edits an existing route |
| III. Runs locally | Pass | Uses the same core-api that local dev already serves |
| IV. Layered tests | Pass | Unit/component tests and an e2e scenario (below). No shared records written, so no new invariants |
| V. Single-table via ElectroDB | Pass | Reuses the existing `byInstructor` index access pattern; no scan, no new index |
| VI. Secure by default | Pass | No infra change. The query is scoped to `ctx`/caller's own `instructorId` input; see Research R3 |
| VII. Change freely | Pass | The mock sections are deleted outright, no flag or fallback |
| VIII. Conventions | Pass | Text-only buttons, helpers folder rules, screenshots by a human task |

**Impact check (Principle IV)**: reads `courseInstructor` and `course` records through the existing `listCoursesByInstructor` procedure, in the same way My Courses does. It writes no shared record, so no counter, completion, enrolment or content-item invariant is touched, and no check needs adding or extending. Existing coverage of that procedure stays as is.

**Post-design re-check**: unchanged, all pass.

## Project Structure

### Documentation (this feature)

```text
specs/20261116-001229-instructor-home-real-courses/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── home-page.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/websites/instructor-portal/src/
├── routes/_authenticated/
│   ├── index.tsx                 # rewritten: real courses, empty/loading/error
│   └── -index.test.tsx           # new component tests
└── components/
    └── course-status.ts          # existing; reused for status labels

packages/e2e/src/scenarios/
└── instructor-home.e2e.ts        # new scenario
```

**Structure Decision**: Edit the existing home route in place. Reuse `Alert`, `Spinner`, `CreateCourseDialog`, `course-status` and the `useCoreApi` hook. Extract the status-label mapping and "published/draft only" filter into `components/` only if My Courses and Home would otherwise duplicate it; the My Courses mock details are not touched here.

## Complexity Tracking

No constitution violations to justify.
