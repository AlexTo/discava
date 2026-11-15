# Implementation Plan: Instructor Dashboard and Course Analytics

**Branch**: `20261115-210425-instructor-dashboard` | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261115-210425-instructor-dashboard/spec.md`

## Summary

Instructors get a dashboard of per-course summary cards and a per-course analytics page: enrolments and active learners over time, completion rate, per-lesson drop-off, and quiz item analysis. Figures are read from aggregate records in the core table, one partition per course, which a new stream handler keeps up to date. Each source record's effect on the aggregates is defined once as a pure "contribution" function in core-table; the handler applies the change between the old and new image exactly once (a marker item per event, and per distinct learner and period), and a rebuild function sums the same contributions over the source records. An invariant compares the two, so the numbers provably match the records. instructor-api gains an `analytics` router that checks the caller teaches the course; the instructor portal's placeholder dashboard becomes real and gains a course analytics route.

What the code showed that the spec could not:

1. The core table's stream already has two consumers (progress recalculation, search indexing), the AWS-recommended maximum per shard. Analytics is a third. Recorded in Complexity Tracking and [research.md](./research.md) R-4.
2. The table has no TTL today. Markers need one, so the `Data` stack's table construct gains a TTL attribute.
3. Source records are keyed by student, so no per-request answer is cheap; that is what makes stream-maintained aggregates the right design and not just the one the issue names (R-1).
4. The e2e suite checks invariants straight after each test, but the stream lags by seconds. The analytics check needs to wait for the aggregates to settle (R-8).

## Technical Context

**Language/Version**: TypeScript (Node 22 Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: ElectroDB (`@discava/core-table`), tRPC + zod, `@aws-lambda-powertools` (parser, logger, metrics, tracer, as the other event handlers), TanStack Router/Query, shadcn charts (`@discava/common-shadcn`), CDK constructs

**Storage**: the one DynamoDB core table, six new entities (`courseStats`, `periodStats`, `lessonStats`, `quizQuestionStats`, `quizScoreStats`, `analyticsMarker`); TTL enabled on the table

**Testing**: vitest per project (with the `@discava/core-table` alias where needed), core-table `helpers/invariants.ts`, Testing Library component tests (`renderWithInstructorApi`, `renderWithCoreApi`), Playwright e2e in `packages/e2e`

**Target Platform**: AWS Lambda, API Gateway, CloudFront (deployed); `pnpm dev` with Docker locally (DynamoDB local streams and the event runner)

**Project Type**: web application: serverless backend (events, instructor-api, core-table, infra) + React portal

**Performance Goals**: a dashboard or detail read is a small fixed number of keyed queries (SC-003); a change shows within 30 seconds (SC-002: stream batching window 5 seconds, same as progress)

**Constraints**: no scans in a user request; no second table; no index added; analytics writes never re-trigger the handler; CloudFormation 500-resource cap per stack (one function, one mapping, one queue added to CoreApi; check at synth); least-privilege per function

**Scale/Scope**: courses of thousands of students; ~hundreds of aggregate items per course; one marker per event with a 7-day expiry

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | Lambda, DynamoDB streams and transactions, TTL; nothing new in kind |
| II. Generators first | Pass | The new handler is a Lambda function in the existing `@discava/events` project, added with the `ts#lambda-function` generator (check with `list-generators` and `generator-guide`); the new instructor-api procedures extend its generator-owned router; the dashboard route is an existing generated route, and the course analytics route follows TanStack Router's file convention. Hand-written parts are the entities, helpers and construct wiring, as for progress |
| III. Everything runs locally | Pass | Event runner gains a third batcher with the same filters and handler; DynamoDB local supports streams and transactions; TTL is not enforced locally (markers only accumulate) |
| IV. Layered tests | Pass, planned | Unit tests for contributions, handler, rebuild, procedures and pages; invariant `analytics-matches-records` plus a test that breaks it; e2e scenario `analytics.e2e.ts`; concurrency test for simultaneous enrolments and completions; see Impact check |
| V. Single-table via ElectroDB | Pass | New entities in the table; access patterns in [data-model.md](./data-model.md), all keyed; contributions to a course share `ANALYTICS#<courseId>` with sort keys making each kind a contiguous range; no index added; the stream consumer's filters are new (`ANALYTICS_STREAM_FILTERS`) and do not widen progress's or search's. A scan appears only in tooling (rebuild reads by key; tests) |
| VI. Secure by default | Pass | Read authorization on every procedure from `ctx.user.sub`; not-found for both unknown and not-taught courses; analytics Lambda gets read-write on the table only; failure queue encrypted as the others; no student identifiers in outputs |
| VII. Change freely before launch | Pass | The dashboard placeholder content is replaced outright, no flag or fallback; no backfill, dev data is rebuilt by hand with the tool |
| VIII. Repo conventions | Pass | Code in `helpers/` one file per topic (`analytics.ts`, `analytics-stream.ts`, `analytics-writes.ts`), text-only buttons, screenshots in a human task, docs translations noted if docs change |

**Re-check after design:** one deviation, the third stream consumer, recorded below. Nothing else changed.

## Impact check (constitution IV)

Shared records this feature **reads in a new way**: `enrolment` (status and `createdAt`, by stream and by the rebuild), `progress` (status per lesson, by stream and rebuild), `itemCompletion`, `quizAttempt`, `quizSummary` (stream and rebuild), `courseInstructor` (authorization), curriculum entities (names, order, visibility at read time). **Writes** only its own new entities; it never writes a source record.

| Record | Existing checks that cover it | What this adds |
|--------|-------------------------------|----------------|
| `enrolment` status, `progressPercent`, `completedAt` | progress invariants (recalculation) | Aggregates must equal sums over these; `analytics-matches-records`. No change to what a status means |
| `progress` | progress invariants | Same; lesson funnel is a sum over statuses of non-dropped enrolments; the handler skips `progress` records whose enrolment is `dropped` (keyed enrolment read, see research.md) |
| `itemCompletion`, `quizAttempt`, `quizSummary` | `studentActivityWrites` invariants, quiz attempt checks | Same; they are immutable or monotone (`bestScore` only rises), which the contributions rely on, so an existing check that `bestScore` never falls is cited in tasks and extended if absent |
| `courseInstructor` | authorization tests of other instructor procedures | New procedures get their own authorization tests (instructor, co-instructor, other instructor, student, removed instructor) |
| curriculum visibility | curriculum and progress invariants | Read-time filter only; tested |

Because the feature changes no meaning of a counted record, it extends no existing check: it adds `analytics-matches-records` (and its breaking test) and the `ANALYTICS_STREAM_FILTERS` test that none of the aggregate entities pass a filter. `tasks.md` carries a task for each.

## Design Decisions (detail in [research.md](./research.md))

1. **Aggregates are sums of contributions.** One pure function in core-table says what each source record contributes (R-3). The handler applies `contributions(new) - contributions(old)`; the rebuild sums `contributions` over everything. A definition can't differ between them.
2. **Exactly-once.** Counts apply in a transaction with an event marker; distinct learners apply in their own transaction with a member marker (R-2). Redelivery and retry change nothing.
3. **Third stream mapping**, filtered, batched over 5 seconds, its own failure queue (R-4).
4. **Reads in instructor-api** with a course-instructor check on every procedure; cards use one batch get, the detail view a few queries joined with the curriculum (R-5).
5. **Hidden and deleted content is filtered when read**, so restoring content brings its numbers back and the aggregates never need curriculum-aware deletes.
6. **Rebuild** is tooling, run by tests and by hand, never in a request (R-10).
7. **UTC everywhere**: days and weeks are UTC, weeks run Monday to Sunday.

## Project Structure

### Documentation (this feature)

```text
specs/20261115-210425-instructor-dashboard/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── instructor-api-analytics.md
│   └── instructor-portal-ui.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/
├── databases/core-table/src/
│   ├── entities/
│   │   ├── course-stats.ts, period-stats.ts, lesson-stats.ts
│   │   ├── quiz-question-stats.ts, quiz-score-stats.ts, analytics-marker.ts
│   │   └── index.ts, ../service.ts          # register
│   └── helpers/
│       ├── analytics.ts                     # contributions(), rebuildCourseAnalytics() (+ test)
│       ├── analytics-writes.ts              # apply a change: marker transactions (+ test)
│       ├── analytics-stream.ts              # ANALYTICS_STREAM_FILTERS, matcher (+ test)
│       ├── analytics-reads.ts               # keyed reads for the router (+ test)
│       └── invariants.ts                    # analytics-matches-records (+ tests)
├── events/src/
│   ├── analytics/analytics-update.ts        # stream handler (+ test); generator-created function
│   └── local/event-runner.ts                # third batcher
├── apis/instructor-api/src/
│   ├── procedures/analytics.ts              # courseSummaries, course, quiz (+ test)
│   ├── schema/analytics.ts
│   └── router.ts
├── common/
│   ├── constructs/src/core/dynamodb.ts      # table TTL attribute
│   └── scripts/src/                         # rebuild-analytics target
├── infra/src/stacks/core-api-stack.ts       # third event source mapping, failure queue, grants
├── websites/instructor-portal/src/routes/_authenticated/dashboard/
│   ├── route.tsx                            # summary cards
│   ├── $courseId/route.tsx                  # course analytics page
│   └── -components/                         # charts, drop-off, quiz panel (+ tests)
└── e2e/src/
    ├── scenarios/analytics.e2e.ts
    ├── concurrency/                         # simultaneous enrolments and completions
    └── helpers/                             # wait-for-analytics, invariant polling
```

**Structure Decision**: extend the existing packages. New files are the six entities, four helpers and one handler; no new project.

## Risks

- **R1: stream reader limit.** Three mappings is above AWS's advice of two. Each polls about once a second, under the 5 per second shard limit. A human task checks for throttling after deploy; Pipes or a Kinesis destination is the escape hatch.
- **R2: lag against the post-test invariant.** The e2e invariant check must wait for aggregates to settle (R-8) or it will flake.
- **R3: marker cost.** One transaction per event with a marker costs roughly double the write units of a bare counter. Accepted: exactness is the acceptance criterion, and rates are tiny next to reads.
- **R4: monotone assumption.** `bestScore` only rises and attempts are immutable. If either changes, contributions must change with it. The plan cites the existing checks.
- **R5: stack resource limit.** One function, one mapping, one queue added to CoreApi. Check the count at synth; move the mapping to another stack if close.
- **R6: TTL attribute on a live table.** Enabling TTL is an in-place table update; confirm the construct (and its checkov checks) allows it.

## Complexity Tracking

| Violation | Why needed | Simpler alternative rejected because |
|-----------|-----------|--------------------------------------|
| A third DynamoDB stream consumer (above the recommended two per shard) | Analytics must follow the same stream as progress, with its own filters, failure queue and retries | Folding it into progress recalculation couples two unrelated retry domains; Pipes or a Kinesis destination add infrastructure and a local stand-in for no benefit at three readers |
