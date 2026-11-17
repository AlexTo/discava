# Implementation Plan: Instructor Announcements to Enrolled Students

**Branch**: `20261115-210422-announcements` | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261115-210422-announcements/spec.md`

**Depends on**: [`specs/20261115-204427-notifications/`](../20261115-204427-notifications/plan.md) (PR #331, issue #281), through its [producer contract](../20261115-204427-notifications/contracts/producer-helpers.md). Which of its tasks must land first is in [Dependency gate](#dependency-gate).

## Summary

Instructors of a published course post rich-text announcements; every student enrolled when the notification pipeline processes it is notified; enrolled students read them in the course home, instructors manage them in the instructor portal. One new core-table entity (`announcement`, no index), four instructor-api procedures (create, list, update, delete), one core-api procedure (list), a shared plain-text excerpt helper, two portal sections, two invariants, and an end-to-end scenario. Delivery is not built here: creating an announcement adds one audience request to its own transaction through the notifications contract's `notifyCourseStudents`, and the pipeline does the rest.

Things the code showed that the spec could not:

1. The student portal's `/learn/$courseId/` is the public course page and `/learn/$courseId/home` is the enrolled student's home, but the notifications registry points `announcement.posted` at the former. The one contract change this feature needs is that path ([contracts/announcement-producer.md](./contracts/announcement-producer.md)).
2. The instructor portal's course page lives in `my-courses_/$courseId/route.tsx`; a child route there would make it a layout. The announcements section therefore sits on that page (research R-7).
3. Tiptap documents are the one rich-text format and `common-tiptap` is the home of their schema, so the excerpt helper goes there and core-table stays free of editor code (research R-5).

## Dependency gate

This feature uses notifications' registry, `notifyCourseStudents`, `notificationBroadcast`, stream filters and invariant snapshot. Notifications tasks (see `specs/20261115-204427-notifications/tasks.md`) that must be merged before each part here:

| Here | Needs from notifications | Task ids | Phase |
|------|--------------------------|----------|-------|
| Phase 1 foundations (helper, invariants) and Phase 2 (create) | Entities, registry with `announcement.posted`, stream filters; `notifyCourseStudents` and its validation; invariant snapshot with broadcasts | T001 to T004, T007 | 1 and 2 |
| Phase 6 e2e (students actually receive the notification) | Fan-out and the local event runner | T014, T016 | 5 |
| Phase 6 e2e (assert in the bell) and the human checks | Notification API and bell | T008 to T010, T028 to T030 | 3 and 8 |
| Email in the human checks | Email phases | T011 to T013, T015, T018 to T027 | 4, 6 and 7 |

The first task of this feature's task list records the gate as a (human) check. Phases 1 to 5 here can be built as soon as notifications Phases 1 and 2 are merged; Phase 6's e2e assertions that need Phase 3, 5 and 8 are written against what has merged and the task names which.

## Technical Context

**Language/Version**: TypeScript (Node 22 Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: tRPC + zod, ElectroDB (`@discava/core-table`), `@discava/common-tiptap`, `uuid` (catalog; already in instructor-api, added to the instructor portal), TanStack Router/Query, shadcn and `RichTextView` (`@discava/common-shadcn`)

**Storage**: the one DynamoDB core table; new entity `announcement`; one `notificationBroadcast` per post through the notifications helper

**Testing**: vitest (unit, per-project `vitest.config.mts` with the `@discava/core-table` alias, already set in instructor-api; core-api has one), core-table `helpers/invariants.ts` checks, Testing Library component tests, Playwright e2e in `packages/e2e` including `src/concurrency/`

**Target Platform**: AWS Lambda + API Gateway (deployed); `pnpm dev` with Docker locally

**Project Type**: web application: two tRPC APIs and two React portals

**Performance Goals**: posting is one request and one transaction of four items regardless of audience size; a page of 20 announcements is one query plus one batch get

**Constraints**: no second table; keyed query only; no new AWS service, Lambda, route or infrastructure (both routers are existing single-router Lambdas, so the CoreApi and InstructorApi stacks gain no resources); transaction at most 4 items

**Scale/Scope**: tens of announcements per course; courses of thousands of students (handled by the pipeline)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | DynamoDB and the existing Lambdas only |
| II. Generators first | Pass | No new project, Lambda or component; procedures and routers are added to existing generator-owned APIs, and the portals' sections to existing portals |
| III. Everything runs locally | Pass | Nothing new to stand in for; delivery uses the notifications spec's local event runner and inbox |
| IV. Layered tests | Pass, planned | Unit tests per helper and procedure; two invariants with tests that break them; stream-filter test; component tests; `announcement.e2e.ts`; a concurrency test for the double post |
| V. Single-table via ElectroDB | Pass | New entity in the one table, shared course partition, keyed descending query, no index, no scan outside tooling. Stream consumers considered and tested (R-10) |
| VI. Secure by default | Pass | No new infrastructure. Authorization from the caller's identity and the course membership in every procedure and write; no caller-supplied user id; body rendered only through the shared schema |
| VII. Change freely before launch | Pass | New record, no legacy handling; the registry path is changed outright |
| VIII. Repo conventions | Pass | `helpers/announcement.ts` in core-table, `text.ts` in common-tiptap (one topic each), text-only buttons, no catch-all utils |

No violations, so Complexity Tracking is empty.

**Re-check after design:** still passing. The one design judgment is the client-minted id (R-3): it avoids an index and makes posts idempotent, at the cost of trusting the client clock within a validated window.

## Design Decisions (detail in [research.md](./research.md))

1. **One entity, keyed by time-sortable id** (R-1): newest first from the sort key, paging by cursor, no index.
2. **Authorization and course status are in the write** (R-2): `courseInstructor` and `course` checks beside the announcement write, so a concurrent removal or archive cannot slip through.
3. **Client-minted UUID v7 makes a post idempotent** (R-3): `createdAt` is derived from the id, so a retried post reproduces the same notification request.
4. **Publish only through the contract** (R-4): `announcementWrites` calls `notifyCourseStudents`; no notification entity is touched here; one registry path changes.
5. **Excerpt from the shared schema** (R-5), computed in the procedure and passed as a string.
6. **Two read paths** (R-6): core-api for students (enrolment rule), instructor-api for instructors (membership rule), one shared page helper.
7. **UI placement** (R-7): student course home card; instructor course-page section.
8. **Invariants** (R-8): shape, and every announcement has its broadcast.
9. **Edit and delete never notify** (spec Clarifications): they call no notification helper, asserted in tests.

## Project Structure

### Documentation (this feature)

```text
specs/20261115-210422-announcements/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/requirements.md
├── contracts/
│   ├── announcement-producer.md     # use of the notifications contract, the one path change
│   ├── instructor-api-announcement.md
│   ├── core-api-announcement.md
│   └── portal-ui.md
└── tasks.md             # /speckit-tasks, not created here
```

### Source Code (repository root)

```text
packages/
├── common/
│   └── tiptap/src/
│       ├── text.ts                       # plainTextExcerpt (+ test); exported from index.ts
│       └── index.ts
├── databases/core-table/src/
│   ├── entities/announcement.ts          # new entity (+ test), registered in entities/index.ts and service.ts
│   ├── helpers/announcement.ts           # announcementIdTime, announcementWrites, announcementEditWrites,
│   │                                     # announcementDeleteWrites, announcementPage (+ test); exported from index.ts
│   ├── helpers/invariants.ts             # snapshot gains announcements; announcement-shape, announcement-has-broadcast
│   ├── helpers/invariants.test.ts        # tests that break each
│   └── helpers/notification-types.ts     # (notifications' file) announcement.posted path -> /learn/<courseId>/home
├── apis/
│   ├── instructor-api/src/
│   │   ├── schema/announcement.ts, schema/index.ts
│   │   ├── procedures/announcement.ts    # create, list, update, delete (+ test)
│   │   └── router.ts                     # announcement: router({...})
│   └── core-api/src/
│       ├── schema/announcement.ts, schema/index.ts
│       ├── procedures/announcement.ts    # list (+ test)
│       └── router.ts                     # announcement: router({ list })
├── websites/
│   ├── student-portal/src/routes/learn/$courseId/-components/
│   │   ├── announcements.tsx             # card with list, load more (+ test)
│   │   └── course-home.tsx               # renders it above the outline
│   └── instructor-portal/src/routes/_authenticated/my-courses_/$courseId/
│       ├── route.tsx                     # renders the section after the course content
│       └── -components/announcements/    # announcements-section, announcement-form, delete-announcement-dialog (+ tests)
└── e2e/src/
    ├── scenarios/announcement.e2e.ts
    ├── concurrency/announcement.e2e.ts   # same post twice, same id
    └── helpers/announcement.ts
docs/src/content/docs/en/guides/          # instructor guide section (English; translations noted pending)
```

**Structure Decision**: extend existing packages; no new project and no infrastructure change. The only new module outside core-table, the two APIs and the portals is `common-tiptap/src/text.ts`, which sits with the schema it reads.

## Risks

- **R1: notifications not merged.** Everything here that is not the registry path assumes notifications Phases 1 and 2. The gate task stops the work if they are not merged; the helper's unit tests mock `notifyCourseStudents` only after it exists to be imported.
- **R2: client clock skew.** A client more than 10 minutes off is refused with a message ("Check your device's clock"); ordering within the window follows client time. Accepted for announcements.
- **R3: invariant snapshot is shared with notifications.** `announcement-has-broadcast` reads `notificationBroadcast` rows from the snapshot that notifications T007 builds. A change there to the attribute names would break this check; both are covered by tests, which is the point.
- **R4: excerpt quality.** Plain text from rich content can read oddly (lists, formulas). It is a teaser only; the course home shows the real text. Tests pin lists, formulas and long text.
- **R5: dropped student re-enrols.** They see old announcements and are not notified (spec Clarifications), which a test covers at the API level.

## Complexity Tracking

*No constitution violations.*
