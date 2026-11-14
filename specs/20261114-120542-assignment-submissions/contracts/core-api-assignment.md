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

Input: `ref & { files: Array<NewFile | KeptFile> }`, 1 to 5 entries

- `NewFile = { kind: 'new'; objectKey: string; fileName: string }`
- `KeptFile = { kind: 'kept'; key: string }`, where `key` must equal a key in the caller's current submission

Output: `Submission` (below)

Behavior:
1. Read the common records, the caller's submission, the completion, and (new files) the uploads' metadata.
2. Refuse with `PRECONDITION_FAILED` if the course isn't published or the submission is `returned`.
3. `BAD_REQUEST` for: zero or more than 5 files; duplicate file names; a new `objectKey` that isn't one `uploadUrl` issued for this item, this caller and this name; an upload that is missing, whose type isn't the one its name allows, or whose size is 0 or over 100 MB; a kept key not in the current submission.
4. `late = item.dueAt !== undefined && now > item.dueAt`.
5. Copy every new and kept file into `…/submissions/<userId>/<version>-<attemptId>/`, where `version` is the existing version + 1 (or 1). Copies run in parallel.
6. One transaction through `assignmentSubmissionWrites` (first submission or resubmission, as in the data model).
7. On a cancelled transaction: delete this attempt's folder (best effort), re-read, retry up to 3 times, then `CONFLICT`. On a lost race or a `returned` landing in between, the re-read gives the precise error.
8. On success after a resubmit: schedule retirement of the replaced folder (`RETIRED_VERSION_DELAY_MINUTES`). On failure to schedule, log only.

Idempotence: a repeated call with the same new uploads after a success re-reads a newer version and writes another version; it never double-counts the student.

## `assignment.mySubmission` (query)

Input: `ref`

Output: `Submission | null`

- Same common checks, except a course may be archived (read-only). Returns the caller's own record only, found by key.

## `assignment.submissionFileUrl` (query)

Input: `ref & { index: number }` (position in the caller's `files`)

Output: `{ url: string }`

- Same checks as `mySubmission`; `NOT_FOUND` if there is no submission or no file at `index`.
- Returns a CloudFront signed URL for that one object, valid `FILE_URL_LIFETIME_SECONDS` (5 minutes), on the stored key read from the caller's own record. Local dev: S3Mock's unsigned URL.

## `Submission`

```ts
{
  version: number;
  status: 'submitted' | 'returned';
  submittedAt: string;        // ISO timestamp
  late: boolean;
  files: Array<{ fileName: string; fileSize: number; mimeType: string }>; // no storage keys
}
```

Storage keys never leave the API: a student's files are fetched by `index` through `submissionFileUrl`.

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
| Bad type, size, count, duplicate name, bad key | `BAD_REQUEST` |
| Lost a race after retries | `CONFLICT` |
