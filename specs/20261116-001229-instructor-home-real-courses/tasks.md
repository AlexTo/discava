---

description: "Task list for real courses on the instructor home page"
---

# Tasks: Real Courses on the Instructor Home Page

**Input**: Design documents from `/specs/20261116-001229-instructor-home-real-courses/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The Discava constitution (principle IV) requires them, so they are included: component tests for the home route and a `packages/e2e` scenario. There is no backend change, no shared record is written, and so no invariant or concurrency test applies (see the plan's impact check). Write each phase's tests first and see them fail. Never weaken an existing test to make it pass (constitution IV).

**Who runs what**: an automated agent implements these tasks without `pnpm dev` or Docker. It runs component tests, lint, typecheck and `build` locally. The e2e scenario is written by the agent but runs on PR CI (`pr-checks.yml`'s `E2E tests` job). Tasks marked **(human)** need a running local stack or people, and are done by a reviewer before merging.

**Organization**: Three phases, each one agent PR, merged in order. Each leaves `main` green and working. Story labels: US1 real courses (P1), US2 nothing invented (P1), US3 loading and failure (P2). US1 and US2 share one phase because real courses next to sample sections would still show invented facts. Paths are relative to the repository root. Only the last PR closes #342; earlier PRs say "Part of #342" and must not use a closing keyword.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)

---

## Phase 1: User Story 1 - See my real courses, with nothing invented (P1) 🎯 MVP

**PR title**: `feat(instructor-portal): list my real courses on the home page (#342)`

**Goal**: the home page lists the signed-in instructor's draft and published courses from `course.listByInstructor`, each opening its editor, with the empty state, and every sample figure, name and section is gone (US1 and US2).

- [x] T001 [US1] Test first, in new `packages/websites/instructor-portal/src/routes/_authenticated/-index.test.tsx` (follow `my-courses/-route.test.tsx` for mocking `useCoreApi`, `react-oidc-context` and the router): with a mocked list holding one draft, two published and one archived course, the page shows the three non-archived titles with their statuses, no archived title, newest first as returned, and each title links to `/my-courses/<courseId>`; with seven non-archived courses only six show and a "View all courses" link points to `/my-courses`; with an empty list the empty state shows with a "Create a course" action; a course without `imageKey` shows a placeholder; the list is requested with the signed-in user's `sub` as `instructorId` and `limit: 100`, and is not requested before `sub` is known.
- [x] T002 [US1] In `packages/websites/instructor-portal/src/routes/_authenticated/index.tsx` add the `useQuery(trpc.course.listByInstructor.queryOptions(...))` call exactly as `my-courses/route.tsx` does (`enabled: Boolean(instructorId)`), drop archived items, and render a "Your courses" section of up to 6 cards (title, status badge via `components/course-status.ts`, image from `usePublicMediaUrl` or a placeholder), each linking to `/my-courses/$courseId`, plus the empty state with `CreateCourseDialog` and a "View all courses" link to `/my-courses`. Text-only buttons, no arrow icons (constitution VIII). Make T001 pass.

- [x] T003 [US2] Test first, extending `-index.test.tsx`: for an instructor with courses and for one with none, the page contains none of the sample strings ("Applied Mathematics", "Foundations of Biology", "Academic Communication", "Mia Chen", "Oliver Smith", "33 submissions", "Needs attention", "Recent activity", "Upcoming", "Open grading queue", "Create an assignment"); the summary shows the number of non-archived courses and no student or to-grade figures; the greeting uses the profile's name and a neutral "Welcome back" when the profile has none (no `|| 'Alex'` fallback); the introductory sentence makes no claim about submissions.
- [x] T004 [US2] In `packages/websites/instructor-portal/src/routes/_authenticated/index.tsx` delete the `gradingQueue`, `courses`, `upcoming` and `activity` sample arrays, the "Needs attention", "Recent activity" and "Upcoming" sections and the non-working quick actions, keeping only "Create a course". Make the summary report the real non-archived course count, replace the fixed introductory sentence with one that doesn't invent facts, and remove the `'Alex'` name fallback. Remove every import the deletions leave unused, including icons. Make T003 pass and confirm `pnpm nx run @discava/instructor-portal:lint` is clean.

---

## Phase 2: User Story 3 - Loading and failure are handled (P2)

**PR title**: `feat(instructor-portal): loading and error states on the home page (#342)`

**Goal**: a slow or failed load is never mistaken for "no courses".

- [x] T005 [US3] Test first, extending `-index.test.tsx`: while the list is pending (and while `sub` is not yet known) a spinner shows and neither the empty state nor any course card does; when the request fails an `Alert` with "Couldn't load your courses" and a Retry button show and the empty state does not; pressing Retry calls `refetch`, and when it then succeeds the courses show.
- [x] T006 [US3] In `packages/websites/instructor-portal/src/routes/_authenticated/index.tsx` render `Spinner` while pending and `Alert type="error"` with a Retry `Button` (text only) wired to `coursesQuery.refetch()` on error, reusing the components `my-courses/route.tsx` uses and `apiErrorMessage` from `@discava/common-web-utils/api-errors` for the detail. Make T005 pass.

---

## Phase 3: Polish and end to end

**PR title**: `test(instructor-portal): home page scenario (closes #342)`

**Goal**: the whole flow is covered end to end and checked by a person.

- [x] T007 Add `packages/e2e/src/scenarios/instructor-home.e2e.ts` using `packages/e2e/src/helpers/` (see `course-lifecycle.e2e.ts`): a new instructor (own user via the local OIDC "Someone else" form) opens the home page and sees the empty state and none of the sample strings from T003; creates a course with a uniquely named title from the home page's "Create a course"; returns to the home page and sees that title listed; opens it from the card and the editor loads with no "You don't have permission" message. Keep the invariant check after the test and never reset local data (constitution IV). If the course does not appear on return, invalidate `listByInstructor` in `packages/websites/instructor-portal/src/components/create-course-dialog.tsx` on success (plan R5) with a component test in `create-course-dialog.test.tsx`.
- [x] T008 Run `pnpm nx affected --target lint`, `--target test` and `--target build` and fix what they report in files this feature touched. Do not weaken or skip any test.
- [x] T009 (human) Walk through [quickstart.md](./quickstart.md)'s manual steps against `pnpm dev`, also checking that courses appear within about 3 seconds (SC-003), saving a screenshot of each step, including the error state, to `tmp/screenshots/pr-<number>/` (constitution VIII).

---

## Dependencies and order

- Phase 1 then 2 then 3. Phases 1 and 2 edit the same route and its test file, so they cannot run in parallel.
- T001 before T002, T003 before T004, T005 before T006 (tests first).
- T007 needs phase 1 merged; T009 needs everything.

## Implementation strategy

MVP is phase 1: real courses listed and openable and the invented content removed, which fixes the reported error on its own. Phase 2 makes real data safe to depend on. No phase needs a backend, infra or data change.

## Follow-ups (not in this feature)

- My Courses still shows sample per-course figures (`mockCourseDetails`), and `/dashboard` shows seeded mock figures (`seededPercent`).
- `viewCourse` returns FORBIDDEN rather than NOT_FOUND for a nonexistent course.
- `listCoursesByInstructor` doesn't check that the `instructorId` input is the caller (research R3).
