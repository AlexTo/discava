# Implementation Plan: Q&A and Discussion Threads per Lesson

**Branch**: `20261116-013334-lesson-discussions` | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/_archive/20261116-013334-lesson-discussions/spec.md`

## Summary

Two new `core-table` entities hold the feature: `discussionPost` (a question or a reply, one entity so the two staff queues can be sparse indexes over both) and `discussionVote`. Every write goes through one helper, `discussionWrites`, that builds the DynamoDB transaction for each operation (ask, reply, vote, accept, hide, delete, report, dismiss) with the checks that make the counts, the accepted answer and the "unanswered" flag stay true under concurrency. core-api gains a `discussion` router for everything students and instructors both do (list, open, ask, reply, vote, accept, report, delete own); instructor-api gains a `discussion` router for the staff-only part (unanswered queue, reported queue, hide, unhide, delete any, dismiss reports). The student portal gets a Questions section on the lesson page; the instructor portal gets a Questions area per course with Unanswered, Reported and By lesson views. Notification hooks (reply, answered, accepted) are the last phase and join the post's transaction through the notifications spec's `notificationWrites`.

What the code showed that the spec could not:

1. **Access is the rule every other course read already has.** `requireEnrolment` (core-api `procedures/enrolment.ts`) gives exactly the refusal the spec asks for, and instructors are `courseInstructor` records. core-api's procedures accept any signed-in user, so one `requireDiscussionAccess` helper there serves students and instructors, and instructor-api only needs to hold the staff-only calls (research R-7).
2. **The transaction checks for "course published, module and lesson shown" already exist as a pattern** (`studentActivityWrites` in `helpers/student-activity.ts`). Discussion writes reuse the shape but are not student activity: they must not touch `studentActivityCount` or `lastActivityAt`, and a test pins that (Impact check).
3. **Sparse indexes on existing GSIs have a precedent** (`byTranscodePending` on `contentItem`, with a `condition`), so the two staff queues add no index to the table (research R-3).
4. **Permanent lesson deletion is guarded only by `studentActivityCount`** (`instructor-api` `deleteLessonPermanently`). A lesson with posts would be orphaned, so that path gains a discussion check (FR-017, task in Phase 4).
5. **The notifications v1 registry has `discussion.reply` but no thread id and no answered/accepted types.** The link can open the lesson only, and two registry entries are added by this feature (research R-10).
6. **Moderation must work in archived courses and lessons**, while instructor-api's lifecycle helpers (`requireNotArchived`-style) refuse edits there. The discussion procedures deliberately do not use them (spec FR-002).

## Technical Context

**Language/Version**: TypeScript (Node 22 Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: tRPC + zod, ElectroDB (`@discava/core-table`), TanStack Router/Query, shadcn (`@discava/common-shadcn`), `uuid` v7 (already used for course ids) for post ids; the notifications spec's `notificationWrites` (Phase 7 only)

**Storage**: the one core table; new entities `discussionPost` and `discussionVote`; no new index (two sparse entries on `gsi1pk-gsi1sk-index` and `gsi2pk-gsi2sk-index`)

**Testing**: vitest per project (with the `@discava/core-table` alias), core-table `helpers/invariants.ts`, portal component tests (`renderWithCoreApi`, `renderWithInstructorApi`), Playwright e2e in `packages/e2e` including `src/concurrency/`

**Target Platform**: AWS Lambda + API Gateway + CloudFront; `pnpm dev` with Docker locally

**Project Type**: web application: serverless backend + React portals

**Performance Goals**: a lesson's first page of questions, or a thread's first page of replies, is one keyed query; posting is one transaction of 5 to 7 items (at most 11 with notifications), well under the 100-item limit

**Constraints**: no second table, no new index, no scan in a user request; a question holds at most 500 visible replies; transaction sizes stay small by never fanning out; plain text only

**Scale/Scope**: thousands of questions per course, tens of thousands of votes; every list is keyed and paged

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | Lambda, DynamoDB, API Gateway only |
| II. Generators first | Pass | No new project, component or Lambda: extends core-api, instructor-api, core-table and the portals in place. New route files in the portals are made the way existing routes are (file-based routes). The new entities follow existing entity files |
| III. Everything runs locally | Pass | Everything runs in the local API servers against DynamoDB local; notifications use the notifications spec's local stand-ins, nothing new |
| IV. Layered tests | Pass, planned | Unit tests for the helper and each procedure; seven new invariants with breaking tests; portal component tests; an e2e scenario and a concurrency test; Impact check below |
| V. Single-table via ElectroDB | Pass | Two entities; access patterns in [data-model.md](./data-model.md), all keyed; the two staff queues are sparse entries of existing indexes, each for a named pattern; stream consumers checked |
| VI. Secure by default | Pass | No new infra. Access checked on every call from the token; instructor-only calls check the `instructor` group and the `courseInstructor` record; text is rendered as text |
| VII. Change freely before launch | Pass | No compatibility code; nothing is migrated (new entities only) |
| VIII. Repo conventions | Pass | `core-table/src/helpers/discussion.ts`, `common-web-utils/src/discussion`, `common-shadcn` post components; text-only buttons; English docs only |

No violations, so Complexity Tracking is empty.

**Impact check (constitution IV).** Shared records the feature writes or reads in a new way:

| Record | Use | Existing invariants and tests that already cover it | What changes |
|--------|-----|------------------------------------------------------|--------------|
| `course` | Read in every write's transaction (`check`: `status = published`); read for access | `course-has-instructor`, `enrolment-in-published-course` | None. A discussion never writes `course` |
| `module`, `lesson` | `check` that each is visible and not archived in every post write; read for access and for the lesson's title | The curriculum visibility checks in `helpers/curriculum.ts` and their tests | None changed. New check: a post's lesson record exists, even when archived (`discussion-thread-links`) |
| `enrolment` | Read for access. Not written | `completed-at-iff-completed`, `last-activity-at-current`, `activity-count-matches-students` | None. A test pins that a student whose only records are posts and votes is not counted as active and trips none of `student-records-*` |
| `courseInstructor` | Read for the instructor rule, in both APIs | `course-has-instructor` | None |
| `user` | Read: given and family name, through the shared `learnerName` | `instructor-has-user` | Name read only; a missing user gives "Discava learner" |
| `contentItem` | Not touched. `studentActivityCount` is not changed by discussion writes | `activity-count-matches-students` | A pinned test asserts it |
| `discussionPost`, `discussionVote` (new) | Written only by `discussionWrites`; read by both APIs | none yet | Seven new checks, listed in [data-model.md](./data-model.md) "Invariants", each with a breaking test |
| Lesson permanent delete (instructor-api) | New read: does the lesson have any post | `lesson.test.ts` delete cases | Extended: a lesson with a post cannot be deleted permanently; the existing activity case is unchanged |
| Stream consumers | `discussionPost` and `discussionVote` writes appear on the table stream | `progress-stream.test.ts`, `search-stream.test.ts` | Add an assertion to each that INSERT, MODIFY and REMOVE of the two entities match neither `PROGRESS_STREAM_FILTERS` nor `SEARCH_STREAM_FILTERS` |

## Design Decisions (detail in [research.md](./research.md))

1. **One post entity, kind first in the sort key.** `pk = courseId`, `sk = kind, lessonId, threadId, postId`. A lesson's questions are one range (newest first), a thread's replies another (oldest first), and a question is one keyed get (its `postId` equals its `threadId`).
2. **One helper owns every write and every counter.** `discussionWrites(entities, op)` returns the transaction items; counters (`replyCount`, `instructorReplyCount`, `voteCount`), the accepted answer and the `unanswered` and `reported` flags move only there, each write conditioned on the state it read, retried by the caller on a cancelled transaction under the shared policy (up to seven attempts, exponential backoff with full jitter, then `CONFLICT`).
3. **"Unanswered" is a stored sparse flag, not a query.** `unanswered` exists on a question exactly while it is shown, has no accepted answer and no visible instructor reply. It is the key of the course queue (`gsi2`), so the queue is one keyed query.
4. **Reports are a capped set on the post** (`reportedBy`, at most 20 ids) plus a sparse `reported` flag keyed on `gsi1` for the moderation queue; no third entity.
5. **Delete is a tombstone, hide is a flag.** `state` is `shown`, `hidden` or `deleted`. Deleting removes the text (and, for a question, its accepted answer) and keeps the record; hiding keeps the text for instructors.
6. **Votes are their own records keyed by voter**, so "one vote per person per post" is the key, and the post's `voteCount` moves in the same transaction.
7. **The client mints post ids** (UUID v7), accepted within ten minutes of the server clock; a retry is the same id, so posting is idempotent.
8. **Notifications last and optional.** A new reply, an accepted reply and an answered question build notification items inside the same transaction, behind the notifications spec's contract; Phases 1 to 6 ship without it.

## Project Structure

### Documentation (this feature)

```text
specs/_archive/20261116-013334-lesson-discussions/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── core-api-discussion.md
│   ├── instructor-api-discussion.md
│   ├── portal-ui.md
│   └── discussion-notifications.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/
├── databases/core-table/src/
│   ├── entities/discussion-post.ts, discussion-vote.ts   # new (+ index.ts, service.ts)
│   └── helpers/
│       ├── discussion.ts            # ids, text rules, discussionWrites, answeredState, lessonHasDiscussion (+ test)
│       ├── discussion-notifications.ts   # Phase 7: discussionNotificationWrites (+ test)
│       ├── invariants.ts            # discussion posts and votes in the snapshot; seven checks (+ tests)
│       └── progress-stream.test.ts, search-stream.test.ts   # discussion entities match neither
├── apis/
│   ├── core-api/src/
│   │   ├── procedures/discussion.ts       # list, thread, ask, reply, vote, accept, report, removeOwn (+ test)
│   │   ├── helpers/discussion-access.ts   # requireDiscussionAccess (+ test)
│   │   ├── schema/discussion.ts
│   │   └── router.ts                      # `discussion` router (+ router.test.ts)
│   └── instructor-api/src/
│       ├── procedures/discussion.ts       # unanswered, reported, hide, unhide, remove, dismissReports (+ test)
│       ├── procedures/lesson.ts           # permanent delete refuses a lesson with posts (+ test)
│       └── schema/discussion.ts, router.ts
├── common/
│   ├── web-utils/src/discussion/          # constants (limits), newPostId, answered label logic (+ test)
│   └── shadcn/src/discussion/             # PostCard, PostText (+ test)
├── websites/
│   ├── student-portal/src/routes/learn/$courseId/-components/discussion/   # questions section, form, thread (+ tests)
│   └── instructor-portal/src/routes/_authenticated/my-courses_/$courseId_/questions/  # three views (+ tests)
├── e2e/src/
│   ├── scenarios/discussion.e2e.ts
│   ├── concurrency/discussion-counters.e2e.ts
│   └── helpers/discussion.ts
docs/src/content/docs/en/                          # learner and instructor pages
```

**Structure Decision**: extend existing packages; no new project. Presentational post components used by both portals live in `common-shadcn` and pure logic both use in `common-web-utils` (CLAUDE.md placement rules); each portal's containers, which call its API client, stay in the portal.

## Risks

- **R1: contention on a hot question.** Every reply and every vote on the question updates its record. Counters use atomic adds with state conditions, which keep the counts right but do not stop DynamoDB cancelling a transaction that touches a record another in-flight transaction is changing. So every write retries a cancelled transaction from the reads, in both APIs, up to seven attempts with exponential backoff and full jitter (25 ms ceiling doubling to 800 ms), then `CONFLICT`. The concurrency test exercises both.
- **R2: gsi sharing.** `gsi1` and `gsi2` are shared with other entities, and ElectroDB prefixes each entity's key values. A unit test using `.params()` proves the queue queries cannot return another entity's items (as certificates did).
- **R3: notifications spec not merged.** Phase 7 is gated; the task list says exactly which of that spec's tasks it needs. If that spec's contract changes, only Phase 7 and `discussion-notifications.md` change.
- **R4: the notification link opens the lesson, not the thread.** Accepted for v1 (registry v1 has no thread id); the lesson page shows the Questions section and the asker finds their question first when it is recent. Recorded as an open question.
- **R5: students cannot read threads of archived lessons.** Recorded as an open question; the data is kept, instructors read it, and restore brings it back.
- **R6: draft courses.** A draft course has no students and cannot take posts (published only), so the draft-course cascading delete needs no discussion handling; confirmed by a test that the cascade path is reached only for courses that never published (task).

## Complexity Tracking

*No constitution violations.*
