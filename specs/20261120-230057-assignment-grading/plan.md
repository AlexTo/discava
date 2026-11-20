# Implementation Plan: Grading and Feedback for Upload Assignments

**Branch**: `20261120-230057-assignment-grading` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/20261120-230057-assignment-grading/spec.md`

## Summary

Instructors list an upload assignment's submissions, oldest waiting first. They review each one with an in-page preview for PDFs and images, then return it with points and feedback, ask for a resubmission, or amend a returned grade. Students are notified and see their grade and every round of feedback. Instructors get at most one "new submissions" notification per assignment per day. A home-page queue shows waiting work across all their courses.

The design (detail in [research.md](./research.md)):

- the existing `assignmentSubmission` gains a third status, the grade summary, a `reviewRevision` concurrency token, and a sparse `byWaiting` index;
- feedback rounds become their own append-only entity;
- a small marker entity deduplicates the daily instructor notice;
- every write goes through new core-table helpers, with the notification in the same transaction.

Two things the code showed that the spec could not:

1. **Stored files always download.** They carry `Content-Disposition: attachment`, and the portals' CSP blocks `<iframe>`/`<embed>`, so a PDF can't simply be framed. The plan renders PDFs to a canvas with react-pdf and shows images with `<img>`. Neither needs an infrastructure or CSP change (research R-6).
2. **Leaving a course doesn't delete the enrolment.** It sets `dropped`, from the payment code. Keeping the waiting index in step with enrolment would couple payments to grading, so the stored index follows the submission's status only, and enrolment is applied when reading (research R-3). The behaviour the spec asks for is unchanged.

## Technical Context

**Language/Version**: TypeScript (Node 22 Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**:
- tRPC + zod, ElectroDB (`@discava/core-table`), `@aws-sdk/cloudfront-signer` (existing);
- `@discava/common-tiptap` (`isValidTiptapDocument`), TanStack Router/Query, `@discava/common-shadcn`;
- **new in the instructor portal:** `react-pdf` 11.x with `pdfjs-dist` ≥ 6.2.108.

**Storage**:
- the one DynamoDB core table: changed `assignmentSubmission`; new `submissionFeedback` and `submissionNotice`; a new sparse access pattern on the existing `gsi1`;
- lesson media bucket (read only; S3Mock locally).

**Testing**: vitest (unit, component), core-table invariants, Playwright e2e and concurrency tests in `packages/e2e`

**Target Platform**: AWS Lambda + API Gateway + CloudFront (deployed); `pnpm dev` with Docker locally

**Project Type**: web application: serverless APIs plus React portals

**Performance Goals**:
- every grading write is one transaction of 4 items;
- the per-assignment list is two single-partition queries plus batch gets, sorted in memory (research R-4);
- the queue is one query per course taught.

**Constraints**:
- keys or a declared index only, no scans in a request;
- no new GSI (both existing GSIs are generic; `byWaiting` overloads `gsi1`);
- no CSP or CloudFront change;
- 100 items per transaction (instructor fan-out capped at 46);
- react-pdf loaded only on the review page.

**Scale/Scope**: courses of hundreds of students, with the in-memory list revisited past about 20 000 (research R-4). Tens of courses per instructor. Feedback ≤ 20 000 characters per round, unbounded rounds.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|---|---|---|
| I. AWS-native, serverless | Pass | DynamoDB, Lambda and CloudFront only; nothing new in kind |
| II. Generators first | Pass | No new project or component. New routes follow the portals' file routing; new procedures go in existing APIs |
| III. Everything runs locally | Pass | DynamoDB local; S3Mock serves the preview (CORS for any origin); the local event runner delivers notifications and email; TTL on `submissionNotice` isn't enforced locally, which is harmless (markers are keyed by day) |
| IV. Layered tests | Pass, planned | Unit tests per helper and procedure; five new invariants plus an extended one, each with a breaking test; impact check in [data-model.md](./data-model.md#impact-check-constitution-iv); new e2e scenario `assignment-grading.e2e.ts`; concurrency tests for instructor-vs-instructor and instructor-vs-student races |
| V. Single-table via ElectroDB | Pass | Two new entities in the core table. Access patterns A1 to A9 (data-model) are all keyed queries, gets or batch gets. The new access pattern overloads existing `gsi1` sparsely, with no new index. No stream feature reads the changed records |
| VI. Secure by default | Pass | `courseInstructorProcedure` on every instructor procedure; students read only by `ctx.user.sub`; signed URLs of 5 minutes; PDF.js with scripting and eval off, pinned past CVE-2026-16633; the CSP is untouched |
| VII. Change freely before launch | Pass | The `status` enum is widened outright; `mySubmission`'s output changes outright |
| VIII. Repository conventions | Pass | Helpers in `core-table/src/helpers/assignment-grading.ts`; the draft helper stays in the instructor portal's `lib/` (one consumer); text-only buttons; e2e screenshots for every new screen |

**Re-check after Phase 1:** still passing. Two judgment calls are recorded in research:

- filtering by enrolment at read time instead of keeping keys in step (R-3);
- in-memory paging of the per-assignment list (R-4).

Neither breaks a principle. Complexity Tracking is empty.

## Design Decisions

1. **One transaction per instructor action**: the submission patch (conditioned on `version`, `reviewRevision` and `status`), the feedback round, and the student's notification (data-model, transaction contents). It satisfies FR-008, FR-017 and FR-020, SC-004 and SC-005.
2. **Status machine** in [data-model.md](./data-model.md#state-transitions). Students can resubmit from `submitted` or `resubmission_requested`; only `returned` locks.
3. **The waiting index** is written by one helper, `waitingKeys`, called by both the student's submit path and the instructor's helpers. The invariant `submission-waiting-keys` guards it.
4. **Daily instructor notice** through the `submissionNotice` marker inside `submit`'s existing retry loop (research R-5).
5. **Preview**: images through `<img>`, PDFs through react-pdf behind a dynamic import, everything else as a download (research R-6).
6. **Read-only after leaving**: return, request and amend refuse a `dropped` enrolment with `PRECONDITION_FAILED`; the list and queue mark or drop such rows.
7. **Lambda placement**: `assignmentSubmission.fileUrl` joins instructor-api's `MediaUrl` dedicated function. Everything else runs in the default instructor-api function, which already reads and writes the core table.

## Delivery

Eight pull requests, one per phase of [tasks.md](./tasks.md), in order. None of them closes #102 except the last.

| PR (phase) | Contents | Stories |
|---|---|---|
| 1. Grading data (core-table) | Entity changes and the two new entities, `assignment-grading.ts` helpers, invariants, notification types, `entity-writers.json` | — |
| 2. Student side of the rules (core-api) | Resubmit from `resubmission_requested`, `mySubmission` returns the grade and feedback | — |
| 3. Grading APIs (instructor-api) | `assignmentSubmission.*`, `fileUrl` in `MediaUrl` | 1, 3 |
| 4. Student view (student portal) | Grade, feedback and resubmission states | 2, 3 |
| 5. Instructor screens (instructor portal) | Submissions list, review page with preview, browser draft, course-editor link, e2e and concurrency | 1, 3 |
| 6. Daily notice (core-api) | `submit` sends "new submissions" at most once per assignment per day | 4 |
| 7. Grading queue | `gradingQueue.list`, home-page section | 5 |
| 8. Docs and manual checks | Design page, CLAUDE.md notes, (human) checks | — |

## Project Structure

### Documentation (this feature)

```text
specs/20261120-230057-assignment-grading/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── instructor-api-assignment-submission.md
│   ├── core-api-assignment.md
│   └── portal-ui.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/
├── databases/core-table/
│   ├── entity-writers.json                        # regenerated
│   └── src/
│       ├── entities/
│       │   ├── assignment-submission.ts           # status, grade fields, reviewRevision, byWaiting
│       │   ├── submission-feedback.ts             # new
│       │   ├── submission-notice.ts               # new
│       │   └── index.ts                           # + new entities
│       ├── service.ts                             # register entities
│       └── helpers/
│           ├── assignment-submission.ts           # resubmit condition + waiting keys
│           ├── assignment-grading.ts              # new: return/request/amend writes, waitingKeys, notice writes (+ test)
│           ├── notification-types.ts              # + 3 types (+ test)
│           └── invariants/
│               ├── assignment-grading.ts          # new checks (+ test)
│               ├── student-activity.ts            # extend assignment-submission-shape
│               └── index.ts                       # register
├── apis/
│   ├── instructor-api/src/
│   │   ├── procedures/assignment-submission.ts    # list, get, fileUrl, return, requestResubmission, amendGrade (+ test)
│   │   ├── procedures/grading-queue.ts            # list (+ test), phase 7
│   │   ├── schema/assignment-submission.ts
│   │   └── router.ts
│   └── core-api/src/
│       ├── procedures/assignment.ts               # open on resubmission_requested, notice, mySubmission output (+ test)
│       └── schema/assignment.ts
├── common/constructs/src/app/apis/instructor-api.ts   # MediaUrl gains assignmentSubmission.fileUrl
├── websites/
│   ├── instructor-portal/
│   │   ├── package.json                           # + react-pdf
│   │   └── src/
│   │       ├── components/app-layout.tsx          # segmentLabels: assignments, submissions
│   │       ├── lib/grading-draft.ts               # (+ test)
│   │       └── routes/_authenticated/
│   │           ├── index.tsx                      # Waiting for grading (phase 7)
│   │           ├── my-courses_/$courseId/-components/course/course-modules.tsx  # Submissions link
│   │           └── my-courses_/$courseId_/assignments/$contentItemId/submissions/
│   │               ├── index.tsx                  # list (+ test)
│   │               ├── $userId.tsx                # review (+ test)
│   │               └── -components/               # submissions-table, grading-form, feedback-history, file-preview, pdf-preview
│   └── student-portal/src/routes/learn/$courseId/-components/
│       ├── assignment-item.tsx                    # grade, feedback, resubmission states (+ test)
│       └── assignment-feedback.tsx                # new
└── e2e/src/
    ├── scenarios/assignment-grading.e2e.ts        # new
    ├── scenarios/instructor-home.e2e.ts           # extended in phase 7 (queue shown; forbidden strings still absent)
    ├── concurrency/concurrent-writes.e2e.ts       # return vs return, return vs resubmit
    └── helpers/assignment.ts                      # grading helpers
```

**Structure Decision**: extend the existing packages; no new project. The only new dependency is react-pdf in the instructor portal.

## Risks

- **R1: in-memory listing at scale.** The per-assignment list reads all enrolments. That's fine at hundreds and acceptable to about 20 000 (research R-4); past that, move to per-state queries.
- **R2: PDF rendering gaps.** JPEG 2000 and JBIG2 images inside PDFs may not draw under the CSP (research R-6). The page still renders, and Download always works. A component test covers the fallback when rendering throws.
- **R3: Invariant coverage check.** instructor-api becomes the second package writing `assignmentSubmission`. The PR must change `helpers/invariants/` (it does) and regenerate `entity-writers.json`, or the "Invariant coverage" check fails.
- **R4: `instructor-home.e2e.ts` forbids certain strings.** The queue's text must avoid them; the test is extended, not weakened (constitution IV).
- **R5: submit retry semantics.** Adding the marker adds a cancellation reason to `submit`. Classify it explicitly so a marker race never surfaces as a student-facing `CONFLICT` (unit test plus concurrency test with two students submitting at once on a fresh day).

## Complexity Tracking

*No constitution violations.*
