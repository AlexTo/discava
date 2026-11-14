# Implementation Plan: Student Submissions for Upload Assignments

**Branch**: `20261114-120542-assignment-submissions` | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261114-120542-assignment-submissions/spec.md`

## Summary

Students submit one file (at most 100 MB) to an upload assignment (a content item of type `assignment` in a lesson of kind `assignment`, shipped in #294), resubmit until an instructor returns it, and view and download their own submission. core-api gains an `assignment` router (`uploadUrl`, `submit`, `mySubmission`, `submissionFileUrl`) that reuses the file-item upload, check and copy path and the existing `assignmentSubmission` entity. Every write goes through one new `core-table` helper that composes `studentActivityWrites`, so the activity count, the item completion and the submission land in one transaction. The student portal learns about assignment lessons: core-api's course read exposes the lesson `kind` and the assignment item, the outline marks assignments, and an assignment opens straight to a submit form.

Two things the code showed that the spec could not:

1. core-api's `course.view` output has neither lesson `kind` nor the `assignment` item type, so a student viewing a course containing an upload assignment from #294 would fail output validation today. Fixing it is the first core-api fix in the foundation.
2. core-api has no S3 or scheduler plumbing. The file helpers and cleanup scheduler live in instructor-api's `lib/`, so they move to `common-server-utils` (the repo's home for code shared by two Lambdas). `packages/events` keeps its own copy of the scheduler and the bucket resolver today; it switches to the shared modules too, so there is one of each.

## Technical Context

**Language/Version**: TypeScript (Node 22 Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: tRPC + zod, ElectroDB (`@discava/core-table`), `@aws-sdk/client-s3` and `s3-request-presigner`, `@aws-sdk/client-scheduler`, `@aws-sdk/cloudfront-signer`, TanStack Router/Query, shadcn (`@discava/common-shadcn`), CDK constructs

**Storage**: the one DynamoDB core table (existing `assignmentSubmission`, `itemCompletion`, `contentItem`, `enrolment` entities); lesson media upload bucket (2-day expiry) and lesson media bucket (S3Mock locally)

**Testing**: vitest (unit, per-project `vitest.config.mts` with the `@discava/core-table` alias), core-table `helpers/invariants.ts` checks, Playwright e2e in `packages/e2e` including `src/concurrency/`

**Target Platform**: AWS Lambda + API Gateway + CloudFront (deployed); `pnpm dev` with Docker (DynamoDB local, S3Mock, event runner) locally

**Project Type**: web application: serverless backend (core-api, infra) + React portal

**Performance Goals**: submit completes in one request. The slowest part is one server-side copy of up to 100 MB inside S3, which stays within the function's 25 s timeout, itself below API Gateway's 29 s limit (checked in research, risk R1).

**Constraints**: no second table; keys or declared index only; each Lambda gets only the permissions its procedures need; CloudFormation 500-resource cap per stack (CoreApi stack gains one function, `AssignmentSubmit`, and four routes); upload bucket expires objects after 2 days

**Scale/Scope**: one record per student per assignment; one file each; courses of hundreds of students

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | S3, Lambda, EventBridge Scheduler, CloudFront; nothing new in kind |
| II. Generators first | Pass | No new project or component is scaffolded. New dedicated core-api functions come from `CORE_API_DEDICATED_FUNCTIONS`, the repo's own mechanism, not a generator target |
| III. Everything runs locally | Pass | S3Mock serves upload, head, copy and download; the local event runner already stands in for the Scheduler (`/schedules/transcode-cleanup`); its schedule request gains a delay so the attempt guard can't fire while its own request is running |
| IV. Layered tests | Pass, planned | Unit tests per procedure and helper; a new invariant plus a test that breaks it; `assignment.e2e.ts`; a concurrency test for racing resubmits |
| V. Single-table via ElectroDB | Pass | No new entity or index. Access patterns are in [data-model.md](./data-model.md); all are keyed gets. The cleanup handler's check before deleting a submission folder is one more keyed get, outside any user request. The unused `byUser` index from #294 is left alone: this feature doesn't use it |
| VI. Secure by default | Pass | Presigned PUT bound to type and exact length; per-function least privilege; 5-minute signed download URLs; student reads keyed by `ctx.user.sub`, never a caller-supplied user id; the `transcode-cleanup` Lambda gains read-only access to the core table and nothing else |
| VII. Change freely before launch | Pass | `Lesson.kind` and the new item type are added to core-api's output outright, with no fallback; `assignmentSubmission.files` becomes `file` outright |
| VIII. Repo conventions | Pass | Shared S3 code goes in `common-server-utils` modules; core-table code in `helpers/assignment-submission.ts`; text-only buttons |

No violations, so Complexity Tracking is empty.

**Re-check after design:** still passing. The one judgment call is moving instructor-api's S3 helpers into `common-server-utils` (a refactor that touches working code). The alternative, duplicating them in core-api, would break the "shared by two Lambdas" convention in CLAUDE.md.

## Design Decisions (detail in [research.md](./research.md))

1. **One transaction for the whole write.** `assignmentSubmissionWrites` in core-table calls `studentActivityWrites` (course published, ancestors shown, enrolled, `lastActivityAt` forward, activity count only when the student has neither a submission nor a completion for the item), writes the submission (create on first, version-conditioned patch on resubmit) and creates the item completion if it doesn't exist.
2. **S3 happens around the transaction, DynamoDB decides.** Schedule a conditional cleanup of a folder unique to this request (`<attemptId>`), copy the uploaded file into it once, then run the transaction; a try cancelled by an unrelated write reuses the copy, and a lost race ends in `CONFLICT`. If the request ends without a commit, delete the folder; if it crashes, the scheduled cleanup does. On a successful resubmit, schedule retirement of the old folder. The cleanup never deletes the folder holding a student's current file. The folder is not named for the version because two attempts at the same version would otherwise share a folder, and a version in the name would force a new copy on every retry (research R-3).
3. **One file, replaced whole.** A submission holds exactly one file. A resubmission uploads a replacement and carries nothing over, so each version folder is complete on its own and the old one is retired after a delay (research R-4).
4. **Late flag** is `dueAt !== undefined && submittedAt > dueAt`, set inside `assignmentSubmissionWrites` with `submittedAt` from `studentActivityAt(enrolment)` and the `dueAt` read in the same try, so the stored flag always agrees with the stored time.
5. **Dedicated functions for privileged operations.** `assignment.uploadUrl` and `assignment.submit` get a new dedicated function (S3 and Scheduler rights); `assignment.submissionFileUrl` joins `MediaUrl` (the CloudFront signing key).
6. **Access rule for reads**: enrolled (archived courses included), module, lesson and item shown. Submitting also requires a published course (enforced inside the transaction).

## Submit-screen states (student portal)

Settles the item left open after clarify; the full table is in [contracts/student-portal-ui.md](./contracts/student-portal-ui.md). Summary: no submission, file chosen, uploading with progress, submitting, submitted (with late notice), resubmit form showing the current file, refused (type, size), conflict (retry), locked (returned), unavailable.

## Project Structure

### Documentation (this feature)

```text
specs/20261114-120542-assignment-submissions/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── core-api-assignment.md
│   └── student-portal-ui.md
└── tasks.md             # /speckit-tasks, not created here
```

### Source Code (repository root)

```text
packages/
├── common/
│   ├── server-utils/src/
│   │   ├── local-dev.ts              # LocalScheduleRequest gains delaySeconds
│   │   ├── lesson-files.ts           # moved from instructor-api/lib + LESSON_FILE_TYPES/MAX_BYTES
│   │   ├── lesson-files.test.ts
│   │   ├── lesson-media-bucket.ts    # S3 client + bucket-name resolution (was instructor-api/lib/s3-client.ts)
│   │   └── cleanup-scheduler.ts      # from instructor-api/lib and events/lib: best-effort and throwing variants
│   └── constructs/src/app/apis/core-api.ts   # CORE_API_DEDICATED_FUNCTIONS: + AssignmentSubmit, MediaUrl gains submissionFileUrl
├── databases/core-table/src/
│   ├── entities/assignment-submission.ts     # `files` list becomes one `file` map
│   └── helpers/
│       ├── assignment-submission.ts          # assignmentSubmissionWrites (+ test)
│       └── invariants.ts                     # extend checks, add assignment-submission-shape (+ tests)
├── apis/
│   ├── core-api/src/
│   │   ├── procedures/assignment.ts          # uploadUrl, submit, mySubmission, submissionFileUrl (+ test)
│   │   ├── procedures/course.ts              # asStudentContentItem handles 'assignment'; lesson kind
│   │   ├── schema/assignment.ts, course.ts   # new schemas; Lesson.kind, assignment item
│   │   └── router.ts
│   └── instructor-api/src/lib/               # imports switch to common-server-utils
├── events/src/media/transcode-cleanup.ts     # optional keepIfCurrentFor check; events/lib scheduler copy removed
├── events/src/local/event-runner.ts          # honors a schedule's delaySeconds
├── infra/src/stacks/media-pipeline-stack.ts  # transcode-cleanup Lambda: read-only on the core table
├── infra/src/stacks/core-api-stack.ts        # grants for the new function; takes upload bucket and media pipeline
├── websites/student-portal/src/routes/learn/$courseId/-components/
│   ├── assignment-item.tsx                   # submit form, submission view
│   ├── course-player.tsx, lesson-page.tsx    # outline marking, direct open
│   └── *.test.tsx
└── e2e/src/
    ├── scenarios/assignment.e2e.ts
    ├── concurrency/ (resubmit race)
    └── helpers/ (assignment helpers)
```

**Structure Decision**: extend the existing packages; no new project. The only new modules are the shared `common-server-utils` files, which exist because two Lambdas now need the code.

## Risks

- **R1: copy time inside one API Gateway call.** One 100 MB server-side copy is normally a few seconds and happens once per request, not once per retry. `AssignmentSubmit`'s timeout is 25 s, below the gateway's 29 s, so a request never commits after the gateway has answered for it; a request that runs out of time fails as a whole and its folder is cleaned up by the guard. T045 measures the copy.
- **R2: stack resource limit.** One more function and four routes in CoreApi. Check the resource count at synth and move something if close.
- **R3: stack dependency order.** CoreApi will take the upload bucket and media pipeline, as InstructorApi already does, and the `transcode-cleanup` Lambda now reads the core table. Confirm no cycle at synth.
- **R4: the cleanup handler's path segment is called `submissionNonce`.** Submission folders pass `submissions/<userId>/<attemptId>` as that segment. The handler gains one optional field, `keepIfCurrentFor`; renaming `submissionNonce` is deliberately left out of this PR.
- **R5: refactor blast radius.** Moving the S3 helpers and the scheduler must keep instructor-api's and events' existing tests green without edits to assertions (constitution IV: tests are a specification).

## Complexity Tracking

*No constitution violations.*
