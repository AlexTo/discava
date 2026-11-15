# Contract: core-api `assignment` router

All procedures are `protectedProcedure`s (Cognito token). The student is always `ctx.user.sub`; no input names a user. `ref` below is `{ courseId, moduleId, lessonId, contentItemId }`, the ids of an upload assignment's single content item.

**Common checks** (every procedure): the course exists and the caller is enrolled and hasn't dropped it; the module, lesson and item exist, are shown (visible, not archived, no hidden or archived ancestor); the item is `type: 'assignment'`. Failure: `NOT_FOUND` (not enrolled, hidden, archived or wrong type), `FORBIDDEN` where enrolment is the cause, as `fileUrl` does today.

Serving function: `uploadUrl` and `submit` on new dedicated function `AssignmentSubmit`; `submissionFileUrl` on `MediaUrl`; `mySubmission` on the shared router.

## `assignment.uploadUrl` (mutation)

Input: `ref & { fileName: string; fileSize: number }`

Output: `{ objectKey: string; uploadUrl: string; headers: Record<string, string> }`

- Extra checks: the course is published; the caller's submission, if any, is not `returned`.
- `fileName`'s extension must be in `LESSON_FILE_TYPES`, else `BAD_REQUEST` listing the allowed types. `fileSize` is a positive integer up to `LESSON_FILE_MAX_BYTES` (100 MB).
- Presigns a PUT to the upload bucket for `…/submissions/<userId>/<uploadId>/<storedName>`, signing the content type and exact content length, valid 15 minutes.
- Local dev: S3Mock URL.

## `assignment.submit` (mutation)

Input: `ref & { objectKey: string; fileName: string }`, the one upload `uploadUrl` issued. A submission holds exactly one file; a resubmission sends a new upload and carries nothing over.

Output: `Submission` (below)

Behavior:
1. Read the common records, the caller's submission, the completion, and the upload's metadata.
2. Refuse with `PRECONDITION_FAILED` if the course isn't published or the submission is `returned`.
3. `BAD_REQUEST` for: an `objectKey` that isn't one `uploadUrl` issued for this item, this caller and this name; an upload that is missing, whose type isn't the one its name allows, or whose size is 0 or over 100 MB.
4. Schedule the attempt guard before copying anything: a conditional cleanup (below) of `…/submissions/<userId>/<attemptId>/` after `SUBMISSION_ATTEMPT_CLEANUP_DELAY_MINUTES` (60), where `attemptId` is a random id made for this request. If scheduling fails, the request fails with `INTERNAL_SERVER_ERROR` (the student can try again) and nothing has been copied.
5. Copy the file once into that folder. The folder name carries no version, so the tries below reuse the copy.
6. Up to 3 tries. Each try uses a fresh read (the first uses step 1's) and runs one transaction through `assignmentSubmissionWrites` (first submission or resubmission, as in the data model), passing the item's `dueAt`. The helper, not the procedure, sets `version` = the read version + 1 (or 1), `submittedAt = studentActivityAt(enrolment)` and `late = dueAt !== undefined && submittedAt > dueAt`.
7. On a cancelled transaction: re-read. If the submission is no longer the one this try read (one now exists, or its version moved), another request won: stop with `CONFLICT`, so exactly one request wins a race and the other is told to retry. If the submission is now `returned`, or the course or item no longer allows submitting, stop with that precise error. Otherwise the cancellation came from an unrelated write (for example the enrolment's `lastActivityAt` moved): try again with the same copy. After 3 tries: `CONFLICT`.
8. Whenever the request ends without a committed record, delete the attempt folder (best effort). If the request crashes or times out instead, the guard from step 4 deletes it.
9. On success after a resubmit: schedule retirement of the replaced folder (the one holding the previous record's file) with the same conditional cleanup, after `RETIRED_VERSION_DELAY_MINUTES`. On failure to schedule, log only.

`AssignmentSubmit`'s timeout is 25 s, below API Gateway's 29 s, so a request cannot commit after the gateway has already answered for it. A client can still lose the response to a request that committed, so the portal re-reads `mySubmission` after any failed submit (see the UI contract).

Idempotence: a repeated call with the same upload after a success re-reads a newer version and writes another version; it never double-counts the student.

## Conditional cleanup of submission folders

Both the attempt guard and the retirement of a replaced folder go through the `transcode-cleanup` handler with `submissionNonce: 'submissions/<userId>/<attemptId>'` and a new optional field `keepIfCurrentFor: <userId>`.

- With `keepIfCurrentFor`, the handler first reads that student's `assignmentSubmission` for the item (consistent read) and deletes nothing when the record's `file.key` is inside the folder. So a folder holding a student's current file is never deleted, whichever schedule fires and whenever.
- The payload also carries the schedule's purpose. An `attempt` cleanup that finds the folder is not current deletes nothing while the record's `submittedAt` is less than `REPLACED_FILE_GRACE_SECONDS` (a download link's lifetime plus a minute) ago. Without this, a guard firing just after its folder's file was replaced would delete that file within seconds of the replacement, breaking a link handed out moments before; the folder's retirement schedule deletes it later. A `retire` cleanup doesn't wait: it fires `RETIRED_VERSION_DELAY_MINUTES` after the replacement.
- Without the field the handler behaves as today (video output).
- The two schedules for one folder need different names: the name hash includes a purpose (`attempt` or `retire`), so retiring a folder within an hour of creating it doesn't collide with its guard.
- The guard's delay must be longer than the submit function's timeout in every environment. Deployed: `SUBMISSION_ATTEMPT_CLEANUP_DELAY_MINUTES` (60) against 25 s. Local dev: the event runner's default delay is a few seconds, so the guard asks it for 60 s (`LocalScheduleRequest.delaySeconds`).

## `assignment.mySubmission` (query)

Input: `ref`

Output: `Submission | null`

- Same common checks, except a course may be archived (read-only). Returns the caller's own record only, found by key.

## `assignment.submissionFileUrl` (query)

Input: `ref`

Output: `{ url: string }`

- Same checks as `mySubmission`; `NOT_FOUND` if there is no submission.
- Returns a CloudFront signed URL for the submission's file, valid `FILE_URL_LIFETIME_SECONDS` (5 minutes), on the stored key read from the caller's own record. Local dev: S3Mock's unsigned URL.

## `Submission`

```ts
{
  version: number;
  status: 'submitted' | 'returned';
  submittedAt: string;        // ISO timestamp
  late: boolean;
  file: { fileName: string; fileSize: number; mimeType: string }; // no storage key
}
```

The storage key never leaves the API: a student's file is fetched through `submissionFileUrl`.

## Changes to existing core-api output

- `course.view` lessons gain `kind: 'lesson' | 'assignment'`.
- `course.view` content items gain `{ type: 'assignment', body, dueAt?, maxPoints }` (no keys; `status` as for the other types).
- `completion.completeContentItem` gains one rule: an upload assignment completes by submitting, so it returns an existing completion but never creates one; without a completion it throws `PRECONDITION_FAILED` ("Submit your work to complete it"). Without this, "Mark as done" could complete an assignment with no submission.

## Errors

| Situation | Code |
|-----------|------|
| Not enrolled, hidden, archived, or not an assignment | `NOT_FOUND` / `FORBIDDEN` (as other student procedures) |
| Course archived (submit, uploadUrl) | `PRECONDITION_FAILED` |
| Submission returned | `PRECONDITION_FAILED` |
| Bad type, size or upload key | `BAD_REQUEST` |
| Lost a race, or still cancelled after 3 tries | `CONFLICT` |
| The attempt guard could not be scheduled (submit) | `INTERNAL_SERVER_ERROR` |
