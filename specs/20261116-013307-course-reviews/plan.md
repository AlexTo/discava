# Implementation Plan: Course Ratings and Written Reviews

**Branch**: `spec/reviews` | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261116-013307-course-reviews/spec.md`

## Summary

Two new core-table entities: `review` (one per student per course, keyed by course and student, so a conditional create enforces "one review") and `courseRating` (one per course: five star counters, from which the count and average follow). Every write that creates, edits, deletes, removes or answers a review is built by one `core-table` helper, `reviewWrites`, which puts the review change and the counter change in one transaction. core-api gains a `review` router (public `summary` and `list`; signed-in `mine`, `post`, `edit`, `delete`); instructor-api gains `review.list`, `respond` and `deleteResponse`; a new admin API (shared with the catalogue categories spec) gains `review.courses`, `list` and `remove`. Search documents carry the rating, so core-api's `course.publicSearch` can sort by rating, filter by a minimum average and boost well-rated courses; the catalogue's `course.publicList` adds the rating to each card with one batch read. The student portal shows ratings on cards and the course page and hosts the review form; the instructor portal gets a Reviews screen; the admin portal gets a Reviews screen.

What the code showed that the spec could not:

1. **The rating cannot live on the `course` record.** `course.updatedAt` is moved by every write to the record (`watch: '*'`), and the `instructor-course-updated-at` invariant requires each instructor's `courseUpdatedAt` to equal it. A counter on `course` would break that invariant on every review and re-index the course on every vote. A separate `courseRating` record avoids both (research R-1).
2. **Search documents are whole-document `index` calls built from fresh reads, not the stream image** (`events/src/search/index-content.ts` `courseIdsOf`/`syncCourse`, `toCourseDocument`). A rating change must therefore re-index the course from fresh reads of both records, and a course change must read the rating, or one write would overwrite the other's fields (research R-5).
3. **The admin portal has no backend.** Only core-api and instructor-api exist. The catalogue categories spec (#333) plans the first `admin-api`; this feature needs the same one (research R-7).
4. **`gsi2` is free for a second pattern.** Only `assignmentSubmission.byUser` uses it; ElectroDB prefixes each entity's key values, so a review index can share it (research R-3).
5. **`course.publicList` already returns up to 100 courses by key**; a `BatchGet` of that page's `courseRating` records (at most 100 keys) adds ratings to cards without a read per card beyond one call.

## Technical Context

**Language/Version**: TypeScript (Node 22 Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: tRPC + zod, ElectroDB (`@discava/core-table`), OpenSearch client (`@discava/search`), TanStack Router/Query, shadcn (`@discava/common-shadcn`); no new runtime library

**Storage**: the one core table; new entities `review`, `courseRating`; one new use of the existing `gsi2pk-gsi2sk-index`; the `courses` search index gains three numeric fields (additive mapping)

**Testing**: vitest per project (with the `@discava/core-table` alias), `helpers/invariants.ts`, portal component tests, Playwright e2e in `packages/e2e` including `src/concurrency/`

**Target Platform**: AWS Lambda + API Gateway + CloudFront + OpenSearch Serverless; `pnpm dev` with Docker locally

**Project Type**: web application: serverless backend + React portals

**Performance Goals**: card and page ratings add one keyed read or one batch read to requests that already exist; a review list page is one query; search ordering adds no query

**Constraints**: no second table; no scans in user requests; the public API never returns user IDs or email; no new stack except the shared AdminApi; the rating write is atomic with the review write

**Scale/Scope**: one record per review; a course page lists at most 20 reviews per page

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | Lambda, DynamoDB, OpenSearch Serverless (already used) only |
| II. Generators first | Pass, with a dependency | `admin-api` must come from the `ts#trpc-api` generator and be connected to the admin portal with `connection`. The #333 plan does this; whichever feature merges first runs the generators, and the other reuses the result (task T-admin). Everything else extends existing projects |
| III. Everything runs locally | Pass | Ratings, reviews and search ordering run in the local servers, local DynamoDB and local OpenSearch; the re-index on a rating change runs in the local event runner through `SEARCH_STREAM_FILTERS`, which it already reads; the admin API's `dev` target and local OIDC (Carol is admin) cover moderation |
| IV. Layered tests | Pass, planned | Unit tests for the helper, procedures and the search document builder; three new invariants with breaking tests; an e2e scenario and a concurrency test; impact check below |
| V. Single-table via ElectroDB | Pass | Two entities, access patterns in [data-model.md](./data-model.md): every request is a key, one declared index (`gsi2`, reused) or a batch of keys. Scans only in invariant tooling. Search stream filters extended deliberately for `courseRating` |
| VI. Secure by default | Pass | Role checks per procedure (student own record only, instructor of the course, admin group); public reads project fixed fields; the AdminApi uses the generator's hardened defaults |
| VII. Change freely before launch | Pass | Attributes, entities and procedure inputs are added outright; no fallbacks |
| VIII. Repo conventions | Pass | `core-table/src/helpers/review.ts`, `helpers/review-rating.ts` beside entities; core-api and search helpers in `helpers/`; text-only buttons (star input is a labelled radio group, not arrows); English docs only |

No violations, so Complexity Tracking is empty.

**Impact check (constitution IV).** Shared records the feature writes or reads in a new way:

| Record | Use | Existing invariants and tests that already cover it | What changes |
|--------|-----|------------------------------------------------------|--------------|
| `enrolment` | Read inside the create transaction (status not `dropped`); read by the new `review-has-enrolment` check. Never written | `completed-at-iff-completed`, `student-records-enrolled`, `enrolment-in-published-course`, `last-activity-at-current` | None changed. A review is not student activity: it does not count toward `studentActivityCount` and does not move `lastActivityAt`. A test pins that a student whose only record is a review trips none of the `student-records-*` checks and does not count in `activity-count-matches-students` |
| `course` | Read: `status` (create allowed only while `published`), `title` (admin screen and notification). Never written | `instructor-course-updated-at`, `published-at-set`, `course-has-instructor` | None changed. A test pins that a review write leaves `course.updatedAt` and every instructor's `courseUpdatedAt` untouched |
| `courseInstructor` | Read: authorise responses (condition check in the transaction); instructors of a course for notifications | `course-has-instructor`, `instructor-has-user` | None |
| `user` | Read: given and family name for the reviewer name and the response author | `instructor-has-user` | Name read only; a missing user gives the fallback name |
| `review` (new) | Written by `reviewWrites` only | none yet | New checks `review-shape` and `review-has-enrolment`, each with a breaking test |
| `courseRating` (new) | Written by `reviewWrites` only; read by core-api and search | none yet | New check `course-rating-matches-reviews` (summary equals the tally of visible reviews; no summary without a course), with a breaking test |
| Stream consumers | `PROGRESS_STREAM_FILTERS`: `review` and `courseRating` records must match none. `SEARCH_STREAM_FILTERS`: gains `courseRating` INSERT and MODIFY on purpose; `review` matches none | `progress-stream.test.ts`, `search-stream.test.ts` | Tests: progress filters ignore both entities; search filters match `courseRating` and not `review` |

## Design Decisions (detail in [research.md](./research.md))

1. **One-review rule by key.** `review` primary key is course + student. `post` is a transaction: `review` create (not exists), `enrolment` condition (status not `dropped`), `course` condition (status `published`), `courseRating` add. A repeat, a race or a removed review's tombstone cancels it on the create condition.
2. **The summary is five counters.** `courseRating` holds `stars1` to `stars5`. Count, total and average are derived, so there is no sum/count pair to drift. `reviewWrites` adds `+1` or `-1` to the right counter in the same transaction as the review change; an edit that changes the rating is one update item on `courseRating` (`ADD stars<old> :neg, stars<new> :one`), because DynamoDB rejects two operations on one item.
3. **Optimistic edits.** Edit, delete and admin removal are conditioned on the `version` the caller read and on `status = visible`; a stale caller gets `CONFLICT` and re-reads. Instructor responses patch separate attributes and do not touch `version`, so they never fail a student's edit.
4. **Tombstone for admin removal.** Removal sets `status = removed` with reason, time and admin, and decrements the counter. The record keeps the create condition blocking, so the author cannot repost. The student's own delete removes the record.
5. **Public reads project fixed fields.** `review.list` and `review.summary` return display name, rating, text, dates and response, never `userId`. Instructor and admin lists return `reviewerId` because acting on a review needs it.
6. **Newest-first list through `gsi2`.** `review.byCourse`: `gsi2pk` course, `gsi2sk` `createdAt` then student. `createdAt` never changes, so edits never rewrite an index key. Removed reviews are filtered out and the query continues until the page is full.
7. **Cards cost one batch read.** `course.publicList` batch-gets the page's `courseRating` records; search hits carry the rating in their document.
8. **Search carries the rating.** The document gets `ratingCount`, `ratingAverage`, `ratingScore` (weighted) and `ratingBoost` (`1 + 0.1 x (score - 3.5)`, `1` when unrated), so the query needs no script. The indexer rebuilds a document from the course and its rating whichever record changed.
9. **Notifications are the last product phase and optional.** They use `notificationWrites` from #331 inside the create transaction, and wait for that helper to exist.

## Project Structure

### Documentation (this feature)

```text
specs/20261116-013307-course-reviews/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── core-api-review.md
│   ├── instructor-api-review.md
│   ├── admin-api-review.md
│   ├── search-and-catalogue.md
│   └── portal-ui.md
├── checklists/
│   ├── requirements.md
│   └── integrity-security-search.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/
├── databases/core-table/src/
│   ├── entities/review.ts, course-rating.ts      # new (+ index.ts, service.ts)
│   └── helpers/
│       ├── review.ts                             # reviewWrites, reviewerName (+ test)
│       ├── review-rating.ts                      # starCounts, average, weightedRating, ratingBoost (+ test)
│       ├── invariants.ts                         # review snapshot; three new checks (+ tests)
│       ├── search-stream.ts                      # courseRating added (+ test); progress-stream.test.ts
├── common/search/                                # course document + mapping gain rating fields
├── events/src/search/                            # course-document.ts, index-content.ts, search-reindex.ts read ratings (+ tests)
├── apis/
│   ├── core-api/src/
│   │   ├── procedures/review.ts                  # summary, list (public); mine, post, edit, delete (+ test)
│   │   ├── procedures/course.ts, search.ts       # card rating; sort, minRating, boost (+ tests)
│   │   ├── schema/review.ts, search.ts, course.ts
│   │   └── router.ts                             # router + PUBLIC_OPERATIONS (+ router.test.ts)
│   ├── instructor-api/src/procedures/review.ts   # list, respond, deleteResponse (+ test)
│   └── admin-api/                                # NEW only if #333 has not generated it; procedures/review.ts
├── websites/
│   ├── student-portal/src/                       # course-page reviews, review form, card rating, search sort and filter
│   ├── instructor-portal/src/routes/_authenticated/my-courses_/$courseId/reviews.tsx
│   └── admin-portal/src/routes/reviews.tsx
├── e2e/src/
│   ├── scenarios/review.e2e.ts
│   ├── concurrency/review-writes.e2e.ts
│   └── helpers/review.ts
docs/src/content/docs/en/                         # learner and instructor page
```

**Structure Decision**: extend existing packages; the only new project is the admin API, generated and shared with #333. Rating arithmetic lives in core-table because the helper, the invariant, core-api and the search document builder all use it (CLAUDE.md: shared by two or more).

## Risks

- **R1: counters going negative or drifting.** A decrement carries a `stars<N> >= 1` condition in the transaction, and the invariant compares counters with the tally of reviews.
- **R2: `gsi2` shared by two entities.** A test with ElectroDB's `.params()` proves a review's course query cannot return an `assignmentSubmission` and the reverse.
- **R3: index lag.** Cards read the table (immediate); search follows the stream within seconds (SC-002 allows 60).
- **R4: search overwrite race.** Every batch rebuilds the document from consistent reads, so reordered or duplicate delivery converges. Only two batches for one course running at the same moment can leave an older document until the next change or a re-index; the stream event router spec accepts this narrow overlap (research R-5).
- **R5: merge order with #333 and #331.** The shared admin API, the shared search document and procedure, and the notification registry's instructor path are called out in tasks as "reuse if present, else create" steps, each with a check for both orders.
- **R6: removed reviews in paged lists.** Filtering after the page can shorten it; the list loops until the page is full or the index is exhausted.

## Complexity Tracking

*No constitution violations.*
