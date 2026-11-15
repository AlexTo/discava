# Implementation Plan: Course Completion Certificates

**Branch**: `spec/certificates` | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261115-204447-certificates/spec.md`

## Summary

When the progress recalculation marks a student's enrolment completed in a course that has certificates on, it issues one `certificate` record through a new `core-table` helper. A certificate is created with a conditional put keyed by student and course, so a retry or a concurrent recalculation finds the existing one instead of creating another. core-api gains a `certificate` router: `verify` (public, by ID), `myCertificates` and `pdf` (owner only; the PDF is drawn on demand with `pdf-lib`, nothing stored). instructor-api gains one course setting, `certificatesEnabled`. The student portal gets a public `/certificates/$certificateId` page and a Certificate action on My Learning.

What the code showed that the spec could not:

1. Completion is decided in `packages/events/src/progress/recalculate.ts`, not in core-api's `completeContentItem`. The enrolment patch is conditioned on `status = 'active'`, so only one recalculation wins the transition, but the loser, or a retry after the winner crashed before issuing, still reaches the certificate step. Issuing therefore must be idempotent on its own and must not depend on winning the transition (research R-1).
2. `recalculateStudent` returns early for dropped students and only has the enrolment, completions and progress. It does not read the course or the user today; the certificate step adds those two keyed gets, only when the student is completed and no certificate exists.
3. Public access needs a new `publicProcedure` entry in `PUBLIC_OPERATIONS`, which API Gateway uses to skip its Cognito authorizer.

## Technical Context

**Language/Version**: TypeScript (Node 22 Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: tRPC + zod, ElectroDB (`@discava/core-table`), `pdf-lib` (pure JavaScript, no native binaries, new in core-api only), `node:crypto` for IDs, TanStack Router/Query, shadcn (`@discava/common-shadcn`)

**Storage**: the one core table; new `certificate` entity; new `certificatesEnabled` attribute on `course`

**Testing**: vitest per project (with the `@discava/core-table` alias), core-table `helpers/invariants.ts`, instructor and student portal component tests, Playwright e2e in `packages/e2e` including `src/concurrency/`

**Target Platform**: AWS Lambda + API Gateway + CloudFront; `pnpm dev` with Docker locally

**Project Type**: web application: serverless backend + React portals

**Performance Goals**: certificate visible within 30 s of the last item (the recalculation already runs within seconds); PDF drawn in well under 1 s inside the shared router Lambda

**Constraints**: no second table; no scans in user requests; the public lookup returns only name, course, date and ID; no new stack resources: at most one entry in the public route list; the recalculation Lambda's table grant is already read/write

**Scale/Scope**: one record per student per completed course

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | Lambda, DynamoDB, API Gateway only; no new service |
| II. Generators first | Pass | No new project, component or Lambda; extends core-api, instructor-api, events, core-table and the student portal in place. The public route is an addition to the existing API construct's list, not a generated component |
| III. Everything runs locally | Pass | Issuing runs in the local event runner's existing progress path (stream to recalculation); PDF drawing and the public lookup run in the local servers; nothing new to stand in for |
| IV. Layered tests | Pass, planned | Unit tests for the helper, ID generator, procedures, PDF builder and recalculation step; new invariants and breaking tests; an e2e scenario; a concurrency test for double recalculation. Impact check below |
| V. Single-table via ElectroDB | Pass | One new entity; access patterns in [data-model.md](./data-model.md), all keyed (primary get, primary query by student, one declared index for the public ID lookup). The index is the existing `gsi1pk-gsi1sk-index`, so no new index and no new write cost beyond the item's own |
| VI. Secure by default | Pass | Public lookup behind the existing WAF; ID is 80 bits; the verify response is a fixed four-field projection; PDF and list read by `ctx.user.sub` only; no relaxed default |
| VII. Change freely before launch | Pass | `certificatesEnabled` added outright; absence reads as on, which is the default, not a compatibility fallback for old data |
| VIII. Repo conventions | Pass | `core-table/src/helpers/certificate.ts`, core-api `helpers`-style modules for the PDF; text-only buttons; docs page in English only |

No violations, so Complexity Tracking is empty.

**Impact check (constitution IV).** Shared records the feature writes or reads in a new way:

| Record | Use | Existing invariants and tests that already cover it | What changes |
|--------|-----|------------------------------------------------------|--------------|
| `enrolment` | Read: status `completed`, `completedAt`, to decide and date issuance. Not written by this feature | `completed-at-iff-completed`, `progress-matches-completions`, `enrolment-in-published-course`, `last-activity-at-current` | None changed. A new check ties certificates to completed enrolments |
| `course` | Read: `title`, `certificatesEnabled`. Written: `certificatesEnabled` only, by instructor-api | `course-has-instructor`, `instructor-course-updated-at` (the setting's write must go through the same `updatedAt` handling course edits already use) | `instructor-course-updated-at` stays satisfied: the setting procedure moves `updatedAt` like other course edits, with its existing breaking test extended to cover it |
| `user` | Read: given and family name | `instructor-has-user` (instructors only) | Name read only; a missing user is tolerated (fallback name) |
| `certificate` (new) | Written by the recalculation; read by core-api | none yet | New checks: `certificate-shape` (ID format, unique ID, name, title, dates), `certificate-has-completed-enrolment`. `student-records-have-targets`, `student-records-enrolled` and `activity-count-matches-students` do not apply: a certificate is not student activity on an item and does not count towards `studentActivityCount` |
| Stream consumers | The `certificate` entity's inserts must not match `PROGRESS_STREAM_FILTERS` or `SEARCH_STREAM_FILTERS` | `progress-stream.test.ts`, `search-stream.test.ts` | Add a test assertion for each that a certificate insert matches neither; the `course` change is `certificatesEnabled`, which the search stream already ignores unless it reads it (confirm, T-task) |

## Design Decisions (detail in [research.md](./research.md))

1. **Idempotence by key, not by transition.** `certificate` primary key is student + course. `issueCertificate` does `create` conditioned on not-exists; on `ConditionalCheckFailed` it reads and returns the existing record. Every recalculation of a completed, enabled student calls it, so the transition winner, the loser and a retry converge.
2. **Public lookup by ID through the existing `gsi1`.** The certificate's `gsi1pk` is its ID, `gsi1sk` a constant. The verify procedure queries that index, projects four fields and returns `NOT_FOUND` for no result.
3. **ID format**: 16 Crockford base32 characters (80 bits) from `crypto.randomBytes`, written `XXXX-XXXX-XXXX-XXXX`; the dashes are cosmetic and normalised away on input (case-insensitive, `O/I/L` accepted as `0/1/1`). The create condition guards only the primary key, so the helper first checks the ID index for the new ID and regenerates on a hit (research R-3).
4. **Snapshot, not join.** Learner name, course title and completion date are copied at issue time (spec FR-003/004); the public page and PDF read only the certificate record.
5. **PDF on demand, owner only.** `certificate.pdf` reads by `{ userId: ctx.user.sub, courseId }`, draws one landscape A4 page with `pdf-lib` standard fonts (text sanitised to what WinAnsi can draw, other characters replaced by `?`), and returns base64. No S3, no new infrastructure.
6. **Setting lives on `course`.** `certificatesEnabled` boolean, read as `!== false`. instructor-api's setting procedure reuses the course-instructor authorisation of other course edits.

## Project Structure

### Documentation (this feature)

```text
specs/20261115-204447-certificates/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── core-api-certificate.md
│   ├── instructor-api-course-setting.md
│   └── student-portal-ui.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/
├── databases/core-table/src/
│   ├── entities/certificate.ts            # new entity (+ index.ts export, service.ts)
│   ├── entities/course.ts                 # + certificatesEnabled
│   └── helpers/
│       ├── certificate.ts                 # certificateId(), learnerName(), issueCertificate() (+ test)
│       ├── invariants.ts                  # certificates in snapshot; certificate-shape; certificate-has-completed-enrolment (+ tests)
│       ├── progress-stream.test.ts, search-stream.test.ts   # certificate insert matches neither
├── events/src/progress/recalculate.ts     # issue after completion (+ test)
├── apis/
│   ├── core-api/src/
│   │   ├── procedures/certificate.ts      # verify (public), myCertificates, pdf (+ test)
│   │   ├── helpers/certificate-pdf.ts     # drawCertificatePdf (+ test)
│   │   ├── schema/certificate.ts
│   │   └── router.ts                      # router + PUBLIC_OPERATIONS (+ router.test.ts)
│   └── instructor-api/src/procedures/course.ts   # setCertificates (+ test); course read exposes the flag
├── common/constructs/src/app/apis/core-api.ts    # public route list gains certificate.verify (only if the construct lists them)
├── websites/
│   ├── student-portal/src/routes/
│   │   ├── certificates/$certificateId/index.tsx  # public verification page (+ test)
│   │   └── my-learning/                           # Certificate action (+ test)
│   └── instructor-portal/src/routes/...           # course settings toggle (+ test)
├── e2e/src/
│   ├── scenarios/certificate.e2e.ts
│   ├── concurrency/certificate-issue.e2e.ts
│   └── helpers/certificate.ts
docs/src/content/docs/en/                         # learner and instructor page
```

**Structure Decision**: extend existing packages; no new project. PDF drawing lives in core-api because only `certificate.pdf` uses it (CLAUDE.md: code one Lambda uses stays beside it).

## Risks

- **R1: where core-api learns the portal's origin for the PDF's verification URL.** Reuse `getAllowedOrigin` on the request (the caller is the student portal). If a procedure cannot reach the event, the PDF prints the path only and the page carries the full URL (T-task confirms).
- **R2: `gsi1` shared by two entities.** Both keep `gsi1pk`/`gsi1sk`; key prefixes ElectroDB adds keep values apart. A unit test with a real entity query (or ElectroDB's `.params()`) proves the index query for certificates cannot return enrolments.
- **R3: recalculation Lambda reads two more records and writes one.** Table permissions are already read/write; confirm at synth and in `events` tests.
- **R4: non-Latin names in the PDF** render as `?`; accepted and documented as a limitation (spec edge case).
- **R5: enumeration.** 80-bit IDs plus WAF; no listing endpoint is public.

## Complexity Tracking

*No constitution violations.*
