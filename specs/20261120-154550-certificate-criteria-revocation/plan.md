# Implementation Plan: Certificate Criteria, What Was Assessed, and Revocation

**Branch**: `20261120-154550-certificate-criteria-revocation` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261120-154550-certificate-criteria-revocation/spec.md`

## Summary

A course gains certificate criteria (`certificateCriteria` on the `course` record): today, whether every assessed quiz must be passed. The progress recalculation, which already issues certificates, now issues one only when a shared, pure rule (`evaluateCertificateCriteria`) says the criteria in force are met, and `issueCertificate` copies what was assessed onto the certificate (`assessment`). core-api shows that statement on the public verification page and the PDF, and tells an enrolled student what is still missing (`certificate.requirements`). A certificate can be revoked and restored by an instructor of its course or an administrator, through two core-table helpers that also append a `certificateEvent`; a revoked certificate's public page shows only its ID, status and date, and its PDF is refused. The criterion on graded uploads is the last phase and waits on #102 part 3.

What the code showed that the spec could not:

1. **Completion is decided and certificates are issued in one place**: `recalculateStudent` (`packages/events/src/progress/recalculate.ts`). It already has the curriculum, reads the course and the user only for a completed student with no certificate, and calls `issueCertificate`, the only writer of `certificate`. The criteria check slots in at that call; nothing about `completed` changes (research R-1).
2. **A quiz item completes when passed *or* out of attempts**, and `quizSummary.passedAt` is set once and never cleared. So "completed" does not imply "passed", which is exactly the gap the quiz criterion closes, and a pass is already a permanent, keyed fact per student and quiz.
3. **Nothing re-runs the recalculation when a quiz is passed after its item completed, or when a course setting changes.** `PROGRESS_STREAM_FILTERS` matches a new `itemCompletion` and curriculum edits only. Three more stream cases are needed, each discarded by the handler unless a relevant field changed (R-5).
4. **A certificate has no key by course.** Its primary key is the student; the public lookup uses `gsi1`. An instructor's list needs one more access pattern, served by the existing `gsi2pk-gsi2sk-index` (R-11).
5. **`issueCertificate` returns an existing record before anything else**, and the recalculation stops when it finds one. A revoked certificate therefore blocks re-issue with no new code (R-7).
6. **Refunds end the enrolment with `dropped` and keep `completedAt`**, and `certificate-has-completed-enrolment` already accepts that. Because this plan does not revoke on refund, that check and the checkout spec are untouched (R-8).
7. **Grading does not exist**: `assignmentSubmission` has `status: 'submitted' | 'returned'` but no `points`, and nothing writes `returned`. The graded-upload criterion is planned against issue #102 section 3 and isolated in Phase 8 (R-13).

## Technical Context

**Language/Version**: TypeScript (Node 22 Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: tRPC + zod, ElectroDB (`@discava/core-table`), `@libpdf/core` (already in core-api for the PDF), TanStack Router/Query, shadcn (`@discava/common-shadcn`). No new dependency.

**Storage**: the one core table. One new entity (`certificateEvent`), new attributes on `course` and `certificate`, one new use of an existing index.

**Testing**: vitest per project; core-table `helpers/invariants/` with breaking tests; portal component tests (`renderWithCoreApi`, `renderWithInstructorApi`, `renderWithAdminApi`); Playwright e2e and concurrency tests in `packages/e2e`, run by PR CI.

**Target Platform**: AWS Lambda, API Gateway, CloudFront, DynamoDB streams through the stream event router; `pnpm dev` with Docker locally.

**Project Type**: web application: serverless backend and three React portals.

**Performance Goals**: a certificate within 30 seconds of the event that makes a student qualify (the recalculation's queue batches for up to five seconds); the public page in one request; a revocation visible on the next request.

**Constraints**: no scan in a user request; the public response is a fixed projection with no learner data when revoked; no new stack resources, public operations or infrastructure; `certificate.verify` stays the only public certificate operation.

**Scale/Scope**: one certificate per student per course; a handful of events per certificate at most; a course's certificate list paged by 50. A criteria change costs one recalculation per enrolled student, like a curriculum change.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | Lambda, DynamoDB and its stream only; no new service |
| II. Generators first | Pass | No new project, API, Lambda or construct. The work extends core-table, events, the three APIs and the three portals in place; the admin portal page and the routers are files in existing projects, which no generator scaffolds |
| III. Everything runs locally | Pass | The local event runner already runs the stream router and the progress recalculation from `STREAM_FEATURES`; the new filters are in that list. Notifications use the existing local inbox. Nothing new to stand in for |
| IV. Layered tests | Pass, planned | Unit tests for the rule, helpers, procedures, PDF and handler; new and widened invariants with breaking tests; two e2e scenarios and a concurrency test. Impact check below |
| V. Single-table via ElectroDB | Pass | Access patterns in [data-model.md](./data-model.md), all keyed. One index use added, for a named pattern, on an existing index. Stream consumers considered: the progress feature's registration changes; search and the others are checked not to react |
| VI. Secure by default | Pass | No relaxed default. The public response shrinks for a revoked certificate. Revocation is limited to the course's instructors and administrators by the existing procedure bases. The private note and the per-item list never leave the instructor and admin APIs |
| VII. Change freely before launch | Pass | `certificateCriteria` and `assessment` are required with no fallback; `certificate.verify`'s output changes shape outright; existing development data is fixed by hand (T007) |
| VIII. Repo conventions | Pass | Helpers in `helpers/`, one file per topic; kebab-case files; text-only buttons; e2e screenshots with `screenshot()`; English docs only, translations noted as pending |

No violations, so Complexity Tracking is empty. Re-checked after design: unchanged.

**Impact check (constitution IV).** Shared records the feature writes, or reads in a new way:

| Record | Use | Existing invariants and tests that cover it | What changes |
|--------|-----|----------------------------------------------|--------------|
| `certificate` | Written by `issueCertificate` (now with `assessment`) and, new, by `revokeCertificate` and `restoreCertificate`, called from instructor-api and admin-api. Read by core-api, and now listed by course | `certificate-shape`, `certificate-has-completed-enrolment`; `certificate.test.ts`; e2e `certificate.e2e.ts`, `concurrency/certificate-issue.e2e.ts` | `certificate-shape` is **widened** (assessment coherent, revocation fields all or none). New `certificate-met-criteria` and `certificate-status-matches-history`. `certificate-has-completed-enrolment` is unchanged, with new tests pinning it for a revoked certificate. `entity-writers.json` regenerated: two more packages reach the entity, through core-table helpers only |
| `certificateEvent` (new) | Written only by the two helpers | none | Added to `TableSnapshot` and `SNAPSHOT_ENTITIES`; covered by `certificate-status-matches-history` |
| `course` | Read: `certificateCriteria`, `durationHours` (new reads at issue). Written: `certificateCriteria`, by `course.create` and `setCertificateCriteria` | `course-has-instructor`, `instructor-course-updated-at`, the payments checks on price | New `course-certificate-criteria-shape`. `instructor-course-updated-at`'s test is extended for the new mutation |
| `quizSummary` | Read in a new way: `passedAt` and `bestScore` decide and describe a certificate | `student-records-*`, `activity-count-matches-students`, quiz procedure tests | Not written. `certificate-met-criteria` reads it. Its stream records now reach the progress feature: `progress-stream.test.ts` gains the cases, and a test that an attempt which does not newly pass recalculates nobody |
| `enrolment` | Read as today (`completed`, `completedAt`, not `dropped`) | `completed-at-iff-completed`, `certificate-has-completed-enrolment`, `enrolment-order-matches` | Nothing. Completion's meaning is unchanged, which a recalculation test pins: a student who fails a quiz under the criterion is still `completed` |
| `itemCompletion`, `progress`, `contentItem` | Read as today; `contentItem.settings.passMarkPercent` is read by the rule | curriculum and student-activity checks | Nothing |
| `assignmentSubmission` (Phase 8) | Read in a new way: `status`, `points` decide a certificate | `assignment-submissions` checks; whatever #102 part 3 adds | `certificate-met-criteria` extended for upload items; the stream filter and its tests extended |
| `notification` | Written through `publishNotification`, two new types | notifications checks and `notification-types.test.ts` | Type tests for both; no rule changes |
| `order` | Not read, not written | payments checks | Nothing (R-8) |
| Stream consumers | `PROGRESS_STREAM_FILTERS` gains `quizSummary` and `course` (Phase 8: `assignmentSubmission`) | `progress-stream.test.ts`, `stream-features.test.ts`, `search-stream.test.ts` | Tests for each new match and for each record the handler must discard; a test that `certificate` and `certificateEvent` records match no feature |

## Design Decisions (detail in [research.md](./research.md))

1. **The criteria gate the certificate, not completion** (R-1).
2. **Criteria live on the course, versioned by a counter; the certificate copies what it was issued under** (R-2, R-3). Nothing joins an issued certificate back to the course.
3. **One pure rule decides "met"**, used by the issuer and by the learner's view (R-4).
4. **Three more stream cases wake the recalculation**, including turning certificates on, which #276 left to chance (R-5).
5. **Criteria in force at evaluation apply**; issued certificates are never touched (R-6).
6. **Revocation is a state on the certificate plus an append-only event**, written together by one helper; instructors and administrators only; restorable; never re-issued (R-7).
7. **No automatic revocation on refund** (R-8, the maintainer's decision to confirm).
8. **A revoked certificate's public page shows the ID, the status and the date only** (R-9).
9. **The statement's wording is produced once, in core-api**, and returned to the page and drawn into the PDF (R-12).
10. **Graded uploads last, behind #102 part 3** (R-13).

## Project Structure

### Documentation (this feature)

```text
specs/20261120-154550-certificate-criteria-revocation/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── core-api-certificate.md
│   ├── instructor-api-certificates.md
│   ├── admin-api-certificate.md
│   └── portal-ui.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/
├── databases/core-table/src/
│   ├── entities/course.ts                     # + certificateCriteria
│   ├── entities/certificate.ts                # + assessment, revocation attributes, byCourse index
│   ├── entities/certificate-event.ts          # new (+ index.ts, service.ts)
│   └── helpers/
│       ├── certificate-criteria.ts            # new: evaluateCertificateCriteria, scoreBand, setCertificateCriteria
│       ├── certificate.ts                     # issueCertificate takes the evaluation; revokeCertificate, restoreCertificate
│       ├── progress-stream.ts                 # + quizSummary, course (Phase 8: assignmentSubmission)
│       ├── notification-types.ts              # + certificate.revoked, certificate.restored
│       └── invariants/{certificates.ts,snapshot.ts,test-fixture.ts}
├── events/src/progress/
│   ├── recalculate.ts                         # evaluate before issuing
│   └── progress-recalculation.ts              # which new records recalculate whom
├── apis/
│   ├── core-api/src/
│   │   ├── procedures/certificate.ts          # verify (two shapes), myCertificates, pdf, requirements
│   │   ├── helpers/certificate-statement.ts   # new: assessmentStatement (moves to common-server-utils in Phase 5)
│   │   ├── helpers/certificate-pdf.ts         # draws the statement
│   │   └── schema/certificate.ts
│   ├── instructor-api/src/
│   │   ├── procedures/course.ts               # setCertificateCriteria; create writes the default
│   │   ├── procedures/certificate.ts          # new: list, history, revoke, restore
│   │   └── schema/{course.ts,certificate.ts}
│   └── admin-api/src/
│       ├── procedures/certificate.ts          # new: get, revoke, restore
│       └── schema/certificate.ts
├── websites/
│   ├── student-portal/src/routes/
│   │   ├── learn/$courseId/-components/{certificate-requirements.tsx,course-home.tsx}
│   │   ├── certificates/$certificateId/index.tsx
│   │   └── my-learning/-components/certificate-actions.tsx
│   ├── instructor-portal/src/routes/_authenticated/my-courses_/$courseId/-components/course/
│   │   ├── course-certificate-criteria.tsx    # new
│   │   └── course-certificates-list.tsx       # new
│   └── admin-portal/src/routes/{certificates.tsx,-components/certificates-screen.tsx}
├── common/server-utils/src/certificate-statement.ts   # from Phase 5
├── e2e/src/
│   ├── scenarios/{certificate-criteria.e2e.ts,certificate-revocation.e2e.ts}
│   ├── concurrency/certificate-revoke.e2e.ts
│   └── helpers/certificate.ts
docs/src/content/docs/en/design/{certificates.mdx,progress-and-completion.mdx}
```

**Structure Decision**: extend existing packages; no new project. The rule and the writers live in core-table because two packages decide with them and three write through them. The statement's wording starts in core-api, whose two procedures produce it, and moves to `common-server-utils` when admin-api's lookup becomes a second Lambda using it (code one Lambda uses stays beside it).

## Phases (one agent PR each; detail in tasks.md)

| Phase | Delivers | Waits on |
|-------|----------|----------|
| 1 | Criteria and assessment in the data layer; certificates issued with a statement under default criteria (no visible change) | hand backfill of dev data (T007) |
| 2 | The quiz criterion: enforced, set by the instructor, with the stream cases (MVP) | 1 |
| 3 | The learner's "what is still needed" panel | 2 |
| 4 | The statement on the verification page and the PDF | 1 |
| 5 | Revocation and restore: data, helpers, invariants, the three APIs, notifications | 1 |
| 6 | Revocation in the three portals, e2e and concurrency tests | 5, 3, 4 |
| 7 | Design pages and the reviewer's manual checks | 6 |
| 8 | The graded-upload criterion | **#102 part 3 merged**, and 7 |

## Risks

- **R1: the handler's image comparison for `course` and `quizSummary` records.** The stream delivers DynamoDB JSON; `certificateCriteria` is a map (`M`) and the existing `Image` type reads strings. The handler needs a small typed reader for `certificateCriteria.M.version.N`, `certificatesEnabled.BOOL` and `passedAt.S`, with tests built from real marshalled records.
- **R2: a criteria change on a very large course** recalculates every enrolled student, as a curriculum change does today, within the same batch and concurrency limits. No new limit is introduced; if curriculum changes are acceptable at a given size, this is.
- **R3: `gsi2` shared by a fourth entity.** Proven safe with `.params()` in the entity test, as #276 did for `gsi1`.
- **R4: required attributes on records that already exist.** Until T007 is done on a stage, existing courses and certificates there fail to parse. Same exposure and remedy as `certificatesEnabled` (#276 T027) and the price fields; done before Phase 1 is deployed.
- **R5: the PDF's single page.** Up to five more lines must fit a landscape A4 page with long titles; the existing shrink-to-fit applies and a test draws the longest case.
- **R6: #102 part 3 lands with different names or semantics.** Confined to Phase 8, whose first task is a human check; no earlier phase references grading.
- **R7: #592 (LinkedIn sharing) ships before Phase 5.** It would offer its action on every listed certificate. `myCertificates` gains `status` in Phase 5, and Phase 6 carries a task to hide any share action that exists by then for a revoked certificate.

## Complexity Tracking

*No constitution violations.*
