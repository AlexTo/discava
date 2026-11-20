# Research: Grading and Feedback for Upload Assignments

Findings from reading the code on `main` at `c96a1bbf` (2026-11-20), and the decisions they lead to. Paths are from the repository root.

## What exists today

- `assignmentSubmission` (`packages/databases/core-table/src/entities/assignment-submission.ts`):
  - primary key: pk `[courseId, contentItemId]`, sk `[userId]`;
  - `byUser` on `gsi2`;
  - `status: ['submitted', 'returned']`;
  - no grade or feedback fields.
- `assignmentSubmissionWrites` (`helpers/assignment-submission.ts:59`) conditions a resubmit on `version = existing.version AND status = 'submitted'`. core-api's `requireOpenForSubmitting` (`packages/apis/core-api/src/procedures/assignment.ts:138-151`) refuses a `returned` submission up front.
- The table has two generic GSIs, `gsi1` and `gsi2` (`packages/databases/core-table/config.json:11-22`), both overloaded across entities. `assignmentSubmission` already uses `gsi2`. Sparse-index precedent: `discussionPost.byUnanswered` (`entities/discussion-post.ts:161-196`), `contentItem.byTranscodePending`.
- Instructors are the `courseInstructor` join entity: pk `[courseId]`, sk `[instructorId]`, with `byInstructor` on `gsi1`. instructor-api authorizes with `courseInstructorProcedure` → `requireCourseInstructor` (`packages/apis/instructor-api/src/helpers/course-access.ts:10-21`).
- Enrolments are never deleted. Leaving a course sets `status: 'dropped'`: `refundOrder` (`helpers/order.ts:368-373`), restored by `settleOrderPaid` and `restoreFreeEnrolment`. Readers treat `dropped` as not enrolled (`requireEnrolment`, `packages/apis/core-api/src/procedures/enrolment.ts:38-49`).
- Notifications:
  - `notificationWrites(service, {type, userId, params, dedupeKey, occurredAt})` returns two transaction items (`helpers/notification.ts:120`).
  - The notification id is `sha16(type, dedupeKey)`, and the sort key includes `occurredAt`, so a repeat is only deduplicated when `occurredAt` is also the same.
  - `assignment.returned` is registered (`helpers/notification-types.ts:43-57`, `default-on`) and never sent.
  - `reviewNotifications` caps instructor fan-out at `floor((100 - 4) / 2)`.
- Signed file URLs: `getSignedCloudFrontFileUrl(key)` (`packages/common/server-utils/src/lesson-media.ts:147-171`), lifetime `FILE_URL_LIFETIME_SECONDS = 300`. Local dev uses `localObjectUrl`. instructor-api's `MediaUrl` function (`packages/common/constructs/src/app/apis/instructor-api.ts:61-65`) holds the signing key.
- Stored submission files carry `Content-Type` from the allowlist and `Content-Disposition: attachment` (`lesson-files.ts:284-299`). The media distribution has no cache, origin-request policy or function that could override that, so a signed URL always downloads in a frame or tab.
- The portals' CSP (`packages/common/constructs/src/core/static-website.ts:62-75`) has `img-src https:`, `connect-src https:`, no `frame-src` (so `'self'`) and `object-src 'none'`: an `<iframe>` or `<embed>` of a PDF on the media domain is blocked.
- The lesson media distribution's CORS allows the instructor portal's origin (`packages/infra/src/stacks/data-stack.ts:113-117`), and S3Mock answers any origin (`packages/tooling/local-dev/src/s3mock/start-container.ts:12`).
- Instructor portal:
  - per-course sub-pages use the `my-courses_/$courseId_/…` pattern (`reviews.tsx`, `questions/route.tsx`), with a "Back to course" button and no breadcrumb override;
  - breadcrumb labels are in `segmentLabels` (`packages/websites/instructor-portal/src/components/app-layout.tsx:26-34`);
  - the course editor's lesson row (`-components/course/course-modules.tsx:110-250`) opens `EditAssignmentDialog` for an upload assignment;
  - `RichTextEditor` is local to the instructor portal; `RichTextView` is shared in `common-shadcn`;
  - `PagedList<T>` (`questions/-components/paged-list.tsx:11`) is the paging pattern; there is no shared table component;
  - `relativeTime` is in `common-web-utils/src/discussion.ts:37`;
  - the browser-storage draft pattern is `readQuizDraft`/`writeQuizDraft` (`common-web-utils/src/quiz.ts:200-220`).
- Instructor home (`_authenticated/index.tsx`) only calls `course.listByInstructor`. `packages/e2e/src/scenarios/instructor-home.e2e.ts:11-23` asserts the home page never shows the strings 'Open grading queue', 'Needs attention', '33 submissions', 'Recent activity' or 'Upcoming'.
- Student portal: `assignment-item.tsx` shows the submission and sets `locked` when `status === 'returned'`. It shows no grade or feedback.
- Rich-text limits: announcement body `.max(20_000)` plus `isValidTiptapDocument` plus non-empty text (`packages/apis/instructor-api/src/schema/announcement.ts:17-24`). Assignment `maxPoints` is an integer from 1 to `MAX_ASSIGNMENT_POINTS = 1000`.
- No stream feature reads `assignmentSubmission`. `analytics-update` reads `enrolment`, which this feature doesn't write.

## Decisions

### R-1: Feedback rounds are their own entity, not a list on the submission

- **Decision**: a new `submissionFeedback` entity, one item per instructor action (resubmission request, final return, amendment):
  - pk `[courseId, contentItemId, userId]`, sk `[givenAt, feedbackId]`.
  - The submission keeps only the current grade summary (`points`, `pointsOutOf`, `returnedAt`, `returnedBy`) and a `reviewRevision` counter.
- **Rationale**: feedback is up to 20 000 characters per round, and the number of rounds is unbounded (spec: no limit on resubmission requests). A list on the submission could reach DynamoDB's 400 KB item limit, and every submission read would carry it. One query on the round partition returns a student's history, newest first.
- **Alternatives**: a list attribute on the submission (rejected: item size, and the per-assignment list would read every round); the current feedback on the submission plus history elsewhere (rejected: two copies of the same text).

### R-2: Version-checked instructor writes with a review revision

- **Decision**:
  - The submission gains `reviewRevision` (starts at 0, incremented by every instructor action).
  - Return and resubmission request are conditioned on `version = viewedVersion AND reviewRevision = viewedRevision AND status IN (submitted, resubmission_requested)`; a resubmission request requires `status = submitted`.
  - An amendment is conditioned on `status = returned AND reviewRevision = viewedRevision`.
  - The student's resubmit condition becomes `version = existing.version AND status IN (submitted, resubmission_requested)`.
- **Rationale**: a return can't land on a version the instructor didn't see (FR-008, SC-004), because the student's resubmit bumps `version`. Two instructors racing both read the same `reviewRevision`, so exactly one wins (SC-005). The condition on the one item serializes the student and the instructor without a lock.
- **Alternatives**: conditioning on `updatedAt` (rejected: ElectroDB rewrites it on every write, and string timestamps can tie).

### R-3: The waiting-work index is a sparse key on `gsi1`, filtered by enrolment at read time

- **Decision**:
  - `assignmentSubmission` gains `byWaiting` on `gsi1` (`gsi2` is taken by `byUser`).
  - pk `$assignmentsubmission_waiting#${waitingCourseId}`, sk `[waitingSince, contentItemId, userId]`, present only while `status = 'submitted'`.
  - `waitingCourseId` is set to `courseId` and `waitingSince` to `submittedAt` on submit, resubmit and "back to waiting". Both are removed on return and on resubmission request. Same pattern as `discussionPost.byUnanswered`.
  - Enrolment is applied when reading: the queue and the counts batch-get the listed students' enrolments and drop `dropped` ones.
- **Rationale**:
  - The grading queue (FR-021) becomes one query per course the instructor teaches (`courseInstructor.byInstructor`), each already ordered oldest first, merged in memory.
  - Filtering by enrolment at read time keeps the refund and checkout writers (`refundOrder`, `settleOrderPaid`, `restoreFreeEnrolment`) untouched. If they had to clear or restore index keys, each would need to query every submission the student has in the course inside its own transaction, and the payment code would gain a second responsibility.
  - Re-enrolment needs no write at all: the submission appears again.
- **Alternatives**:
  - keying the index on enrolment too (rejected: couples payments to grading, unbounded items in a refund transaction);
  - per instructor (rejected: a course's instructors change, and each change would rewrite every waiting entry);
  - scanning every assignment in every course (rejected by constitution V and FR-021).
- **Consequence for the spec**: FR-023's "lookup agrees with the student's enrolment" is met by the read path, not the stored key. The invariant checks the stored key against `status` only (see data-model). The behaviour the spec asks for (no longer enrolled is never counted as waiting) is unchanged.

### R-4: The per-assignment list reads the whole assignment and pages in memory

- **Decision**:
  - `assignmentSubmission.list` queries every submission for the assignment (one partition) and every enrolment of the course (one partition), merges them, sorts in the order FR-002 gives (ties broken by `userId`), and returns pages of 50.
  - The cursor is opaque and encodes the last row's sort tuple, so a page boundary stays stable while rows change between pages.
- **Rationale**: the sort order mixes four states, and "not submitted" rows exist only as enrolments. No single key orders that. Both reads are single-partition queries, and courses are planned at hundreds of students (the submissions plan's scale). 10 000 enrolments is about 2 MB, a few query pages: still one request well inside Lambda limits.
- **Alternatives**: a per-assignment sparse index for waiting rows plus separate queries per state (rejected: four cursors and still a merge, for no gain at this scale).
- **Revisit when**: a course passes about 20 000 students.

### R-5: "New submissions" deduplication uses a daily marker record

- **Decision**:
  - A small `submissionNotice` entity: pk `[courseId, contentItemId]`, sk `[day]` (UTC `YYYY-MM-DD`), with `ttl` two days later.
  - `submit` reads it before its transaction. If it's absent, the transaction also creates it (`attribute_not_exists`) and writes one `assignment.submissions_received` notification per instructor, capped like reviews.
  - If the transaction is cancelled only because the marker now exists, `submit`'s existing retry loop tries again without the marker and notifications.
- **Rationale**:
  - The notification pipeline only deduplicates on (type, dedupeKey, occurredAt). Bucketing `occurredAt` to midnight would show a wrong time in the bell.
  - The marker makes "at most once per assignment per day" a database fact, and `submit` already retries cancelled transactions (`MAX_SUBMIT_TRIES = 3`).
  - TTL keeps the table clean; the table's TTL attribute is `ttl` (`packages/common/constructs/src/app/dynamodb/core-table.ts`).
- **Alternatives**:
  - a `lastNoticeDay` attribute on the content item (rejected: the item is already in the transaction through `studentActivityWrites`, and DynamoDB allows one operation per item per transaction; it would also make concurrent submitters conflict on the item);
  - sending one notification per submission (rejected in clarify).

### R-6: Previewing PDFs and images inside the page

- **Decision**:
  - **Images** (png, jpg, jpeg, gif, webp): an `<img>` with the existing 5-minute signed URL. Browsers ignore `Content-Disposition` for images, and the CSP already allows `img-src https:`.
  - **PDFs**: `react-pdf` 11 (MIT, over `pdfjs-dist` 6, Apache-2.0) fetches the signed URL and draws pages to a canvas, which is allowed by `connect-src https:` and the CDN's CORS. Its worker is bundled as a same-origin file, so the CSP needs no change.
  - The preview is loaded with a dynamic import, so only the review page downloads PDF.js.
  - PDF.js is configured with `isEvalSupported: false` and scripting off.
  - Use pdfjs-dist ≥ 6.2.108, which has the fix for CVE-2026-16633.
  - Any other type, or a PDF that fails to render, shows the file's details and the Download button.
- **Rationale**:
  - No change to infrastructure, CSP or stored objects (constitution VI).
  - Drawing to a canvas sidesteps the `attachment` disposition entirely.
  - react-pdf is the maintained React wrapper of the most widely used engine (release 11.1.0 on 2026-11-14), and a read-only page view is what it does well.
  - Library survey on 2026-11-20 (react-pdf, pdfjs-dist, EmbedPDF, @react-pdf-viewer, commercial SDKs) is in the conversation that produced this plan. EmbedPDF (PDFium as WebAssembly) is the better fit if file annotation is ever picked up.
- **Known gap**: PDF.js decodes JPEG 2000 and JBIG2 images with WebAssembly, which the CSP's `script-src 'self'` (no `'wasm-unsafe-eval'`) blocks. Those embedded images may not draw. The page still renders and Download works. Loosening the shared CSP for this is not worth it now.
- **Alternatives**:
  - a second copy of each PDF stored `inline` (rejected: doubles storage and the copy step);
  - forwarding `response-content-disposition` through CloudFront (rejected: CloudFront can't pass it to S3 through OAC with a signed URL without a new origin-request policy, and it changes a shared hardened distribution);
  - `<iframe>` (rejected: CSP);
  - EmbedPDF (rejected for now: multi-MB WebAssembly download and needs `'wasm-unsafe-eval'`).

### R-7: Where the code goes

- **core-table**:
  - `helpers/assignment-grading.ts`: `returnSubmissionWrites`, `requestResubmissionWrites`, `amendGradeWrites`, `submissionsReceivedNotificationWrites`, plus the shared `gradingState` and `waitingKeys` used by `assignmentSubmissionWrites`. Every writer of the new fields calls these.
  - A new invariants topic file `helpers/invariants/assignment-grading.ts`.
  - instructor-api becomes a second package writing `assignmentSubmission`, so the Invariant coverage check needs `entity-writers.json` regenerated and new checks (both planned).
- **instructor-api**: `procedures/assignment-submission.ts` (list, get, return, requestResubmission, amendGrade), `procedures/grading-queue.ts` (queue), schemas in `schema/assignment-submission.ts`. `fileUrl` and `previewUrl` join the `MediaUrl` dedicated function.
- **core-api**:
  - `assignment.mySubmission` returns the grade and the feedback rounds;
  - `submit` accepts `resubmission_requested`, returns the submission to waiting and sends the daily instructor notice;
  - `requireOpenForSubmitting` allows `resubmission_requested`.
- **Portals**:
  - instructor routes `my-courses_/$courseId_/assignments/$contentItemId/submissions/index.tsx` and `…/submissions/$userId.tsx`;
  - a "Submissions" link on the assignment row in `course-modules.tsx`;
  - a home-page section "Waiting for grading", whose name avoids the strings `instructor-home.e2e.ts` forbids;
  - in the student portal, `assignment-item.tsx` gains the grade, feedback and resubmission states.
- **Browser draft (FR-010)**: `lib/grading-draft.ts` in the instructor portal, following `readQuizDraft`/`writeQuizDraft`. Only one portal uses it, so it stays there.

### R-8: Limits

- Feedback: Tiptap JSON, at most 20 000 characters of JSON (as announcements). Optional on a final return and an amendment; required, with non-empty text, on a resubmission request.
- Points: a number from 0 to `maxPoints`, at most two decimal places (assignment `maxPoints` is an integer from 1 to 1000).
- Instructor notification fan-out: capped at `floor((100 − submit items) / 2)`, as reviews are. Submit's own items are listed in data-model.
