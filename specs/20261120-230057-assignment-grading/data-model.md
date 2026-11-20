# Data Model: Grading and Feedback for Upload Assignments

All records live in the core table (constitution V). Decisions are explained in [research.md](./research.md).

## `assignmentSubmission` (changed)

`packages/databases/core-table/src/entities/assignment-submission.ts`

| Attribute | Type | Change | Notes |
|---|---|---|---|
| `status` | `'submitted' \| 'resubmission_requested' \| 'returned'` | **widened** | Replaced outright (constitution VII) |
| `reviewRevision` | number, required, default 0 | **new** | +1 on every instructor action (return, request, amend); concurrency token for instructor writes |
| `points` | number | **new** | Set on final return and amendment; absent otherwise |
| `pointsOutOf` | number | **new** | The assignment's `maxPoints` when graded; kept if `maxPoints` later changes |
| `returnedAt` | ISO string | **new** | First final return; not changed by an amendment |
| `returnedBy` | string (user id) | **new** | Instructor of the first final return |
| `gradedAt` | ISO string | **new** | Latest return or amendment |
| `waitingCourseId` | string | **new**, sparse | `= courseId` while `status = 'submitted'`, else absent |
| `waitingSince` | ISO string | **new**, sparse | `= submittedAt` while `status = 'submitted'`, else absent |

Existing attributes are unchanged: `contentItemId`, `userId`, `courseId`, `moduleId`, `lessonId`, `file`, `submittedAt`, `late`, `version`, `createdAt`, `updatedAt`.

### Indexes

| Index | Keys | Use |
|---|---|---|
| primary | pk `[courseId, contentItemId]`, sk `[userId]` | Every submission for an assignment (instructor list); one student's (keyed get) |
| `byUser` (gsi2) | unchanged | A student's submissions in a course |
| **`byWaiting` (gsi1), new, sparse** | pk `$assignmentsubmission_waiting#${waitingCourseId}`, sk `[waitingSince, contentItemId, userId]` | Waiting work in a course, oldest first (grading queue) |

`byWaiting` follows `discussionPost.byUnanswered`. ElectroDB writes its keys only when both composites are present, and every write that changes `status` sets or removes `waitingCourseId` and `waitingSince` together, through the shared `waitingKeys(status, courseId, submittedAt)` helper.

### State transitions

```text
                 submit (first)
  (none) ───────────────────────────► submitted ◄─────────────┐
                                        │  ▲  │                │
                     resubmit (student) │  │  │ request        │ resubmit (student)
                       version+1        └──┘  │ resubmission   │ version+1
                                              ▼ (instructor)   │
                                     resubmission_requested ───┘
                                        │
             return as final            │ return as final (instructor)
  submitted ─────────────────► returned ◄┘
  (instructor)                    │  ▲
                                  └──┘ amend grade (instructor)
```

| Transition | Who | Condition (one item, in a transaction) | Sets |
|---|---|---|---|
| submit (first) | student | create, not exists | `status=submitted`, `version=1`, `reviewRevision=0`, waiting keys |
| resubmit | student | `version = v AND status IN (submitted, resubmission_requested)` | `version=v+1`, `status=submitted`, file, `submittedAt`, `late`, waiting keys |
| request resubmission | instructor | `version = v AND reviewRevision = r AND status = submitted` | `status=resubmission_requested`, `reviewRevision=r+1`, remove waiting keys |
| return as final | instructor | `version = v AND reviewRevision = r AND status IN (submitted, resubmission_requested)` | `status=returned`, `points`, `pointsOutOf`, `returnedAt`, `returnedBy`, `gradedAt`, `reviewRevision=r+1`, remove waiting keys |
| amend grade | instructor | `reviewRevision = r AND status = returned` | `points`, `pointsOutOf`, `gradedAt`, `reviewRevision=r+1` |

Returning or amending is refused before the write when the student's enrolment is `dropped` (spec clarification: read-only), and when `points` is outside `0..maxPoints`.

## `submissionFeedback` (new)

`packages/databases/core-table/src/entities/submission-feedback.ts`: one instructor action on one version of a submission.

| Attribute | Type | Notes |
|---|---|---|
| `courseId`, `contentItemId`, `userId` | string | The submission it belongs to |
| `feedbackId` | string (ULID) | Unique per round |
| `kind` | `'resubmission_requested' \| 'returned' \| 'amended'` | |
| `feedback` | string, optional | Tiptap JSON ≤ 20 000 chars; required and non-empty for `resubmission_requested` |
| `points`, `pointsOutOf` | number, optional | Present for `returned` and `amended`, absent for `resubmission_requested` |
| `version` | number | The submission version the round was about |
| `givenAt` | ISO string | |
| `givenBy` | string (user id) | |

| Index | Keys | Use |
|---|---|---|
| primary | pk `[courseId, contentItemId, userId]`, sk `[givenAt, feedbackId]` | One submission's history; query in reverse for newest first |

Rounds are append-only: nothing edits or deletes one. Deleting an assignment's content permanently is outside this feature; rounds follow the submission's existing treatment, which keeps submissions.

## `submissionNotice` (new)

`packages/databases/core-table/src/entities/submission-notice.ts`: the "instructors were told about new submissions today" marker (research R-5).

| Attribute | Type | Notes |
|---|---|---|
| `courseId`, `contentItemId` | string | |
| `day` | string `YYYY-MM-DD` (UTC) | |
| `ttl` | number (epoch seconds) | Two days after `day` |

| Index | Keys |
|---|---|
| primary | pk `[courseId, contentItemId]`, sk `[day]` |

## Notification types (registry entries)

`packages/databases/core-table/src/helpers/notification-types.ts`

| Type | Recipient | Email | Params | Link | Dedupe key |
|---|---|---|---|---|---|
| `assignment.returned` (existing) | student | default-on | `courseId`, `lessonId`, `assignmentTitle`, `courseTitle` | student `/learn/{courseId}/lesson/{lessonId}` | `feedbackId` |
| `assignment.resubmission_requested` (new) | student | default-on | same | same | `feedbackId` |
| `assignment.grade_updated` (new) | student | default-on | same | same | `feedbackId` |
| `assignment.submissions_received` (new) | each instructor of the course | default-off | `courseId`, `contentItemId`, `assignmentTitle`, `courseTitle` | instructor `/my-courses/{courseId}/assignments/{contentItemId}/submissions` | `{contentItemId}:{day}` |

`assignmentTitle` is the assignment lesson's title.

## Transaction contents

| Operation | Items |
|---|---|
| return as final / request resubmission / amend | submission patch (conditioned), feedback round create, 2 notification items = **4** |
| student submit or resubmit | `studentActivityWrites` (course, module and lesson checks, content item, enrolment = 5), submission, completion = **7**. With the day's first notice, + marker create + 2 per instructor, instructors capped at `floor((100 − 8) / 2) = 46` |

## Access patterns

| # | Pattern | Served by |
|---|---|---|
| A1 | All submissions for an assignment | `assignmentSubmission` primary, pk `[courseId, contentItemId]` |
| A2 | All enrolments in a course (the list's "not submitted" and "no longer enrolled" rows) | `enrolment` primary, pk `[courseId]` |
| A3 | One student's submission | `assignmentSubmission` primary get |
| A4 | A submission's feedback history, newest first | `submissionFeedback` primary, pk `[courseId, contentItemId, userId]`, reverse order |
| A5 | Waiting work in one course, oldest first | `assignmentSubmission.byWaiting` |
| A6 | Courses an instructor teaches | `courseInstructor.byInstructor` (existing) |
| A7 | Enrolment of the queue's students (read-time filter) | `enrolment` batch get |
| A8 | Today's notice marker | `submissionNotice` primary get |
| A9 | Display names of listed students and feedback givers | `user` batch get, named with `defaultDisplayName` (as instructor-api's `review.ts:162` does for one user) |

No scans in a user request. Invariant checks read the snapshot as they do today.

## Invariants (`packages/databases/core-table/src/helpers/invariants/assignment-grading.ts`, new)

| Name | Rule |
|---|---|
| `submission-grade-shape` | `returned` ⇔ `points`, `pointsOutOf`, `returnedAt`, `returnedBy` and `gradedAt` are all present; `0 ≤ points ≤ pointsOutOf`; non-returned submissions have none of them |
| `submission-waiting-keys` | `waitingCourseId` and `waitingSince` present ⇔ `status = 'submitted'`, with `waitingCourseId = courseId` and `waitingSince = submittedAt` |
| `submission-feedback-has-submission` | every round belongs to an existing submission, and `round.version ≤ submission.version` |
| `submission-feedback-shape` | `resubmission_requested` rounds have non-empty feedback and no points; `returned` and `amended` rounds have `0 ≤ points ≤ pointsOutOf` |
| `submission-latest-round-matches` | `resubmission_requested` ⇒ the newest round is a request for the current version; `returned` ⇒ the newest round is `returned` or `amended` and its points equal the submission's; `reviewRevision` = number of rounds |

Existing checks extended: `assignment-submission-shape` (`helpers/invariants/student-activity.ts:399-450`) accepts the new status and fields.

## Impact check (constitution IV)

| Shared record | Written or read in a new way | Existing coverage | This feature |
|---|---|---|---|
| `assignmentSubmission` | Written by instructor-api (new writer); new status and fields; new sparse index | `assignment-submission-shape`, `student-records-*`, `activity-count-matches-students` | Extend `assignment-submission-shape`; add the five checks above; regenerate `entity-writers.json` |
| `itemCompletion` | Unchanged (a resubmission request doesn't undo completion) | `progress-matches-completions` | None; a test asserts no completion change on return or request |
| `contentItem.studentActivityCount` | Unchanged | `activity-count-matches-students` | A test asserts a resubmission after a request doesn't count again |
| `enrolment` | Read in a new way (batch get for the queue) | — | None (read only) |
| `notification`, `notificationState` | Three new types; a new instructor fan-out | `notification-shape`, `notification-unread-count-matches`, `notification-state-exists` | Covered by the existing checks; the registry test lists the new types |
| `submissionFeedback`, `submissionNotice` | New entities | — | New checks above (`submissionNotice` holds no rule beyond its key; its TTL is checked in a unit test) |
