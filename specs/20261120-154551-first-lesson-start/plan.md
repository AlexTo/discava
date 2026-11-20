# Implementation Plan: Start in Lesson One After Enrolling

**Branch**: `20261120-154551-first-lesson-start` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261120-154551-first-lesson-start/spec.md`

## Summary

Enrolling, free or paid, takes the learner straight to the lesson the course would offer under "Start" or "Continue", through a small `/learn/$courseId/start` route that reuses the player's existing "next lesson" rule. The "You're enrolled!" dialog is removed. The first shown lesson's Questions section gains a prompt with one text box: answering posts a marked question through `discussionWrites` and records `answered` on the learner's enrolment in the same transaction, and **Not now** records `dismissed`. The instructor can set the prompt's text per course. Activation, prompt answers and prompt dismissals become three more counters derived from the enrolment record by the existing analytics contributions, so the stream handler, the rebuild and the `analytics-matches-records` invariant pick them up with no new marker, entity, index or per-learner record.

## Technical Context

**Language/Version**: TypeScript (Node 22 Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: ElectroDB (`@discava/core-table`), tRPC and zod (`@discava/core-api`, `@discava/instructor-api`), TanStack Router and Query (portals), shadcn components from `@discava/common-shadcn`. No new runtime library.

**Storage**: The one core table. Four existing entities gain optional attributes (`course`, `enrolment`, `discussionPost`) or counters (`courseStats`, `periodStats`). No new entity, index or record (data-model.md).

**Testing**: vitest unit tests in core-table (helpers, contributions, invariants with breaking tests), core-api and instructor-api (procedures, authorization), portal component tests with `renderWithCoreApi` and `renderWithInstructorApi`, Playwright scenarios with `screenshot()`, and one concurrency test.

**Target Platform**: AWS Lambda behind API Gateway, DynamoDB and its stream. Locally, `pnpm dev`.

**Project Type**: Web application: a serverless backend plus React portals.

**Performance Goals**: Landing adds no request the lesson page would not make anyway (the start route loads the same four queries the lesson page reuses from the cache). Answering the prompt is one transaction of five items plus one curriculum query. Analytics reads stay the same keyed lookups.

**Constraints**:
- The prompt's state is server-side, per learner and course, set once and never cleared (FR-013).
- A learner answers at most once, also under a race (FR-014).
- Nothing counts as student activity (FR-017): `lastActivityAt`, `studentActivityCount` and progress are untouched by the prompt.
- No reminders, emails or notifications (FR-025).
- An agent implements it without a local stack; e2e and concurrency tests run on PR CI.

**Scale/Scope**: One route and three small components in the student portal, one form and one card in the instructor portal, two core-api procedures and one instructor-api procedure, one core-table helper file, one new invariant and two extended ones, three counters. Five implementation PRs.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design: still passes.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | DynamoDB, Lambda and the existing stream consumer only |
| II. Generators first | Pass | No new project or component kind. Procedures, a route file and components are added to existing projects; no generator covers those |
| III. Everything runs locally | Pass | No new AWS service. The local event runner already runs the analytics handler on enrolment changes |
| IV. Layered tests | Pass, planned | Unit tests for every helper and procedure; one new invariant and two extended ones, each with a breaking test; e2e scenarios for enrolling (a main flow) and the prompt; one concurrency test for the answer race. Impact check below |
| V. Single-table via ElectroDB | Pass | Attributes on existing entities only. Every request is served by keys that exist (data-model.md, access patterns). No scan, no index. `STREAM_FEATURES` unchanged: `analytics-update` already receives enrolment changes, and no feature reads the new attributes of `course` or `discussionPost` |
| VI. Secure by default | Pass | No construct or stage config changes. The new procedures sit behind the existing authorizers; the server decides who may answer, and where |
| VII. Change freely before launch | Pass | The enrolled dialog is removed outright; tests that expected it change (listed below). Optional attributes mean "not set", not "old data": a course without its own text uses the default by design |
| VIII. Repo conventions | Pass | Helper in `core-table/src/helpers/first-lesson-prompt.ts`; portal code in route-private `-components/`; text-only buttons; e2e `screenshot()` calls; English docs with translations noted as pending |

**Impact check (constitution IV).** Shared records written, or read in a new way:

| Record | What changes | Existing checks | Added or extended |
|--------|--------------|-----------------|-------------------|
| `enrolment` | New optional `firstLessonPromptState`, written only by two helpers in `first-lesson-prompt.ts` (through `discussionWrites` for an answer). `lastActivityAt` is read in a new way: present means activated | `last-activity-at-current` (it is set exactly when the learner has an activity record, so "activated" can be trusted), `student-records-enrolled`, `enrolment-in-published-course`, the paid-enrolment checks in `payments.ts`. None reads the new attribute; a test pins that setting it trips none of them | New `first-lesson-prompt-matches-answers` (invariants/discussion.ts) with breaking tests |
| `discussionPost` | New optional `promptAnswer` on questions; such a question is never `unanswered` | `discussion-post-shape`, `discussion-unanswered-matches`, `discussion-counts-match` | `discussion-post-shape` extended (only a question may carry it); `discussion-unanswered-matches` follows `answeredState`, which now takes the flag, with a breaking test for a prompt answer wrongly in the queue |
| `courseStats`, `periodStats` | New counters `activated` (summary and enrolment day), `promptAnswered`, `promptDismissed` (summary) | `analytics-matches-records` sums `contributions` over the snapshot, so it covers the new counters as soon as `contributions` emits them | Its tests are extended with a breaking case per new counter. `analytics-contributions.test.ts` pins the diff of every enrolment transition |
| `course` | New optional `firstLessonPrompt`, written by one instructor-api procedure | none applies (no rule spans records) | Unit tests only |

`contentItem.studentActivityCount`, `itemCompletion`, `progress` and `quizAttempt` are not written or read differently.

**Weakened or changed tests (constitution IV).** Intended, named in their tasks, and to be repeated in the PR description:

- `enrolment-actions.test.tsx`: the cases that expect the "You're enrolled!" dialog after `course.enrol` and after a confirmed payment now expect navigation to `/learn/<courseId>/start` (T003).
- `packages/e2e/src/helpers/student-portal.ts` `enrol`: the dialog step is replaced by waiting for the landing page, after which the helper opens the course home, so its fifteen callers see the page they saw before (T006). `course-purchase.e2e.ts` line 80 clicks the dialog's **Start learning**; it now expects the lesson (T007).
- `analytics-contributions.test.ts` and instructor-api `analytics.test.ts`: expected enrolment contributions and totals gain the new counters (T019, T022). No assertion is loosened.

## Design Decisions (detail in [research.md](./research.md))

1. **A start route decides the landing** (R-1): `/learn/$courseId/start` renders nothing but a loading state, reads the course through `useCoursePlayer`, and replaces itself with `nextLesson`'s page, or the course home when there is none. Free and paid enrolments both go there.
2. **Paid return** (R-2): `useCheckoutReturn` calls `onEnrolled` whenever the address says `checkout=success` and the learner is enrolled, waited-for or not, and the course page navigates with `replace`.
3. **Confirmation by history state** (R-3): the start route passes `state: { enrolled: true }`; the lesson page and course home show the line when it is set.
4. **Prompt state on the enrolment** (R-4): `firstLessonPromptState`, set once. Zero new records.
5. **An answer is a marked question** (R-5): `promptAnswer: true`, a title derived from the body, never in the Unanswered queue.
6. **Text: a code default plus an optional course attribute** (R-6).
7. **Activation derived from `lastActivityAt`** (R-7): a pure function of the enrolment image, so the existing event markers, rebuild and invariant keep it exact.
8. **What is measured** (R-8): activation all-time and by enrolment day, prompt answers and dismissals.
9. **First shown lesson is checked on the server** (R-9), from the same visibility filter the student's course view uses.

## Project Structure

### Documentation (this feature)

```text
specs/20261120-154551-first-lesson-start/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R-1 to R-10
├── data-model.md        # Phase 1: attributes, rules, invariants, access patterns
├── quickstart.md        # Phase 1: how to check it
├── contracts/
│   ├── core-api.md               # course.view, enrolment output, discussion.answerPrompt, course.dismissFirstLessonPrompt
│   ├── instructor-api.md         # course.setFirstLessonPrompt, course.view, analytics.course
│   ├── student-portal-ui.md      # landing, confirmation, the prompt
│   └── instructor-portal-ui.md   # the prompt form, the Activation card
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/databases/core-table/src/
├── entities/course.ts                  # + firstLessonPrompt
├── entities/enrolment.ts               # + firstLessonPromptState
├── entities/discussion-post.ts         # + promptAnswer
├── entities/course-stats.ts            # + activated, promptAnswered, promptDismissed
├── entities/period-stats.ts            # + activated
├── helpers/first-lesson-prompt.ts      # new: default, limits, title, state writes, dismiss
├── helpers/curriculum.ts               # + firstShownLesson (beside filterEffectivelyVisible)
├── helpers/discussion-text.ts          # answeredState takes promptAnswer
├── helpers/discussion.ts               # + 'answerPrompt' operation
├── helpers/analytics-contributions.ts  # enrolment contributes the three counters
├── helpers/analytics-reads.ts          # summary and daily figures carry them
└── helpers/invariants/
    ├── discussion.ts                   # + first-lesson-prompt-matches-answers; post shape extended
    └── analytics.test.ts               # breaking cases for the new counters

packages/apis/core-api/src/
├── schema/enrolment.ts, schema/course.ts, schema/discussion.ts
├── procedures/discussion.ts            # + answerPrompt
├── procedures/enrolment.ts             # + dismissFirstLessonPrompt, output carries the state
├── procedures/course.ts                # course.view returns the resolved prompt text
└── router.ts

packages/apis/instructor-api/src/
├── schema/course.ts, schema/analytics.ts
├── procedures/course.ts                # + setCourseFirstLessonPrompt; view returns text and default
├── procedures/analytics.ts             # totals and daily carry activation and prompt counts
└── router.ts

packages/common/shadcn/src/discussion/post-card.tsx      # "Answer to the course prompt" label

packages/websites/student-portal/src/
├── routes/learn/$courseId/start.tsx                     # new route
├── routes/learn/$courseId/-components/
│   ├── start-course.tsx                                 # new: picks the landing page
│   ├── enrolled-notice.tsx                              # new: the one-line confirmation
│   ├── enrolment-actions.tsx                            # dialog removed; navigates to start
│   ├── use-checkout-return.ts                           # onEnrolled also when already enrolled
│   ├── lesson-page.tsx, course-home.tsx                 # render the notice; pass prompt props
│   └── discussion/first-lesson-prompt.tsx               # new
│   └── discussion/questions-section.tsx                 # renders the prompt
└── hooks/use-course-player.ts                           # + isPlaceReady

packages/websites/instructor-portal/src/routes/_authenticated/
├── my-courses_/$courseId/-components/course/course-first-lesson-prompt-form.tsx   # new
├── my-courses_/$courseId/route.tsx
├── dashboard_/$courseId/-components/activation-card.tsx                           # new
└── dashboard_/$courseId/route.tsx

packages/e2e/src/
├── helpers/student-portal.ts           # enrol; + enrolAndLand, answerFirstLessonPrompt
├── scenarios/learn.e2e.ts, course-purchase.e2e.ts, discussion-student.e2e.ts,
│   discussion-instructor.e2e.ts, analytics.e2e.ts
└── concurrency/first-lesson-prompt.e2e.ts   # new

docs/src/content/docs/en/design/course-analytics.mdx
docs/src/content/docs/en/guides/lesson-discussions.mdx
```

**Structure Decision**: The rule that spans records (one answer per learner, tied to the enrolment's state) lives in core-table, where `discussionWrites` already is the only writer of posts, so core-api only authorizes and calls it. The landing is portal-only. Analytics changes follow the dashboard spec's layout exactly: definitions in `analytics-contributions.ts`, reads in `analytics-reads.ts`, shaping in instructor-api.

## Complexity Tracking

No violations to justify.
