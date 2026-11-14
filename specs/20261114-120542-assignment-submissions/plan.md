# Implementation Plan: Student Submissions for Upload Assignments

**Branch**: `20261114-120542-assignment-submissions` | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261114-120542-assignment-submissions/spec.md`

## Summary

Students submit 1–5 files to an upload assignment (a content item of type `assignment` in a lesson of kind `assignment`, shipped in #294), resubmit until an instructor returns it, and view and download their own submission. core-api gains an `assignment` router (`uploadUrl`, `submit`, `mySubmission`, `submissionFileUrl`) that reuses the file-item upload, check and copy path and the existing `assignmentSubmission` entity. Every write goes through one new `core-table` helper that composes `studentActivityWrites`, so the activity count, the item completion and the submission land in one transaction. The student portal learns about assignment lessons: core-api's course read exposes the lesson `kind` and the assignment item, the outline marks assignments, and an assignment opens straight to a submit form.

Two things the code showed that the spec could not:

1. core-api's `course.view` output has neither lesson `kind` nor the `assignment` item type, so a student viewing a course containing an upload assignment from #294 would fail output validation today. Fixing it is the first core-api fix in the foundation.
2. core-api has no S3 or scheduler plumbing. The file helpers and cleanup scheduler live in instructor-api's `lib/`, so they move to `common-server-utils` (the repo's home for code shared by two Lambdas).

## Technical Context

**Language/Version**: TypeScript (Node 22 Lambdas, React 19 + Vite portals), pnpm/Nx monorepo

**Primary Dependencies**: tRPC + zod, ElectroDB (`@discava/core-table`), `@aws-sdk/client-s3` and `s3-request-presigner`, `@aws-sdk/client-scheduler`, `@aws-sdk/cloudfront-signer`, TanStack Router/Query, shadcn (`@discava/common-shadcn`), CDK constructs

**Storage**: the one DynamoDB core table (existing `assignmentSubmission`, `itemCompletion`, `contentItem`, `enrolment` entities); lesson media upload bucket (2-day expiry) and lesson media bucket (S3Mock locally)

**Testing**: vitest (unit, per-project `vitest.config.mts` with the `@discava/core-table` alias), core-table `helpers/invariants.ts` checks, Playwright e2e in `packages/e2e` including `src/concurrency/`

**Target Platform**: AWS Lambda + API Gateway + CloudFront (deployed); `pnpm dev` with Docker (DynamoDB local, S3Mock, event runner) locally

**Project Type**: web application: serverless backend (core-api, infra) + React portal

**Performance Goals**: submit completes in one request. The slowest part is server-side copies of up to 5 × 100 MB inside S3, which stay within API Gateway's 29 s limit (checked in research, risk R1).

**Constraints**: no second table; keys or declared index only; each Lambda gets only the permissions its procedures need; CloudFormation 500-resource cap per stack (CoreApi stack gains two functions); upload bucket expires objects after 2 days

**Scale/Scope**: one record per student per assignment; ≤5 files each; courses of hundreds of students

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | S3, Lambda, EventBridge Scheduler, CloudFront; nothing new in kind |
| II. Generators first | Pass | No new project or component is scaffolded. New dedicated core-api functions come from `CORE_API_DEDICATED_FUNCTIONS`, the repo's own mechanism, not a generator target |
| III. Everything runs locally | Pass | S3Mock serves upload, head, copy and download; the local event runner already stands in for the Scheduler (`/schedules/transcode-cleanup`) |
| IV. Layered tests | Pass, planned | Unit tests per procedure and helper; a new invariant plus a test that breaks it; `assignment.e2e.ts`; a concurrency test for racing resubmits |
| V. Single-table via ElectroDB | Pass | No new entity or index. Access patterns are in [data-model.md](./data-model.md); all are keyed gets. The unused `byUser` index from #294 is left alone: this feature doesn't use it |
| VI. Secure by default | Pass | Presigned PUT bound to type and exact length; per-function least privilege; 5-minute signed download URLs; student reads keyed by `ctx.user.sub`, never a caller-supplied user id |
| VII. Change freely before launch | Pass | `Lesson.kind` and the new item type are added to core-api's output outright, with no fallback |
| VIII. Repo conventions | Pass | Shared S3 code goes in `common-server-utils` modules; core-table code in `helpers/assignment-submission.ts`; text-only buttons |

No violations, so Complexity Tracking is empty.

**Re-check after design:** still passing. The one judgment call is moving instructor-api's S3 helpers into `common-server-utils` (a refactor that touches working code). The alternative, duplicating them in core-api, would break the "shared by two Lambdas" convention in CLAUDE.md.

## Design Decisions (detail in [research.md](./research.md))

1. **One transaction for the whole write.** `assignmentSubmissionWrites` in core-table calls `studentActivityWrites` (course published, ancestors shown, enrolled, `lastActivityAt` forward, activity count on the first submission only), writes the submission (create on first, version-conditioned patch on resubmit) and creates the item completion if it doesn't exist.
2. **S3 happens around the transaction, DynamoDB decides.** Copy new and kept files into a folder unique to this attempt (`<version>-<attemptId>`) first, then run the transaction. If it fails, delete that folder. If it succeeds on a resubmit, schedule retirement of the old folder. A racing loser's transaction fails on the version condition and only its own folder is deleted. This differs from the issue's `<version>` folder name because two attempts at the same version would otherwise share a folder (research R-3).
3. **Kept files are copied, not referenced.** The old version folder is retired after a delay, so kept files are copied server-side into the new folder. Each version folder is therefore complete on its own.
4. **Late flag** is computed at submit time from `dueAt` read in the same pass: `late = dueAt !== undefined && now > dueAt`.
5. **Dedicated functions for privileged operations.** `assignment.uploadUrl` and `assignment.submit` get a new dedicated function (S3 and Scheduler rights); `assignment.submissionFileUrl` joins `MediaUrl` (the CloudFront signing key).
6. **Access rule for reads**: enrolled (archived courses included), module, lesson and item shown. Submitting also requires a published course (enforced inside the transaction).

## Submit-screen states (student portal)

Settles the item left open after clarify; the full table is in [contracts/student-portal-ui.md](./contracts/student-portal-ui.md). Summary: no submission, files selected, uploading with per-file progress, submitting, submitted (with late notice), resubmit form prefilled, refused (type, size, count, duplicate name), conflict (retry), locked (returned), unavailable.

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
│   │   ├── lesson-files.ts           # moved from instructor-api/lib + LESSON_FILE_TYPES/MAX_BYTES
│   │   ├── lesson-files.test.ts
│   │   ├── lesson-media-bucket.ts    # S3 client + bucket-name resolution (was instructor-api/lib/s3-client.ts)
│   │   └── cleanup-scheduler.ts      # moved from instructor-api/lib/transcode-cleanup-scheduler.ts
│   └── constructs/src/app/apis/core-api.ts   # CORE_API_DEDICATED_FUNCTIONS: + AssignmentSubmit, MediaUrl gains submissionFileUrl
├── databases/core-table/src/
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
├── events/src/media/transcode-cleanup.ts     # unchanged: submission folders reuse its nonce path segment
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

- **R1: copy time inside one API Gateway call.** Five 100 MB server-side copies are normally seconds each, but a slow run could pass 29 s. Mitigation: copy in parallel, set the function timeout above the gateway's, and fail with a retryable error. If it proves too slow, a later change can reduce copies by keeping files in stable per-file folders.
- **R2: stack resource limit.** Two more functions and routes in CoreApi. Check the resource count at synth and move something if close.
- **R3: stack dependency order.** CoreApi will take the upload bucket and media pipeline, as InstructorApi already does. Confirm no cycle at synth.
- **R4: the cleanup handler's path segment is called `submissionNonce`.** Submission folders pass `submissions/<userId>/<version>-<attemptId>` as that segment, which works unchanged. Renaming the handler's field is deliberately left out of this PR.
- **R5: refactor blast radius.** Moving instructor-api's S3 helpers must keep its existing tests green without edits to assertions (constitution IV: tests are a specification).

## Complexity Tracking

*No constitution violations.*
