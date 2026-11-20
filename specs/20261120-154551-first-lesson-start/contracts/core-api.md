# Contract: core-api

All procedures below need a signed-in caller, as their neighbours do. None is public.

## Changed outputs

**`course.view`** (`ViewCourseOutputSchema`) gains:

| Field | Type | Notes |
|-------|------|-------|
| `firstLessonPrompt` | string | The text to show: the course's own, else the default. Always present |

`course.publicView` is unchanged.

**`course.enrol`, `course.myEnrolment`** (`EnrolmentSchema`) gain:

| Field | Type | Notes |
|-------|------|-------|
| `firstLessonPromptState` | `'answered' \| 'dismissed'`, optional | Absent while the prompt is open |

`course.myEnrolments` is unchanged.

**Every discussion post output** (`DiscussionPostSchema`) gains `promptAnswer?: boolean`, present (`true`) only on a shown prompt answer the caller may read. For such a post `answered` is never reported as unanswered.

## `discussion.answerPrompt` (mutation)

Input: `{ courseId, moduleId, lessonId, postId, body }`. `postId` is a UUID v7 minted by the portal, as for `discussion.ask`. `body` is plain text, 1 to 4,000 characters after trimming (the limits of a question's details).

Output: the stored post, as `discussion.ask` returns it, with `promptAnswer: true`.

| Case | Result |
|------|--------|
| Caller is enrolled (not `dropped`), the course is published, the lesson is the first shown lesson, no state yet | The post is created and the enrolment's `firstLessonPromptState` becomes `answered`, in one transaction |
| Same `postId` again by the same caller (a retry) | The stored post, unchanged |
| `postId` used by someone else, or not a recent UUID v7 | As `discussion.ask` |
| The enrolment's state is already `answered` or `dismissed` | `PRECONDITION_FAILED`, "You've already answered or dismissed this prompt" |
| The lesson is shown but is not the first shown lesson | `PRECONDITION_FAILED`, "This prompt belongs to the course's first lesson" |
| Caller is not enrolled, or the enrolment is `dropped` (an instructor who is not enrolled included) | Refused as `discussion.ask` refuses a non-enrolled student (`FORBIDDEN`, or `NOT_FOUND` when the course is not visible to them) |
| The course is archived | Refused as `discussion.ask` is (read-only) |
| The lesson or its module is hidden, archived or unknown | `NOT_FOUND`, as `discussion.ask` |
| Empty or too-long body | `BAD_REQUEST` naming the field, as `discussion.ask` |
| Two answers at the same moment | One succeeds. The other is re-read and gets the retry or the "already answered" result |

Nothing is notified. No student activity is recorded.

## `course.dismissFirstLessonPrompt` (mutation)

Input: `{ courseId }`. Output: the caller's enrolment (`EnrolmentSchema`).

| Case | Result |
|------|--------|
| Enrolled, no state yet | `firstLessonPromptState` becomes `dismissed` |
| State already set (either value) | The enrolment unchanged: success, so a double click or a second device is harmless |
| Not enrolled, or `dropped` | Refused as `course.myEnrolment`'s neighbours refuse (`FORBIDDEN` or `NOT_FOUND`) |

It works whatever the course's status, so a prompt can always be closed.

## Tests

Unit tests for both procedures cover every row above, with a signed-out caller, an unenrolled student, an enrolled student, an instructor of the course who is not enrolled, and another course's instructor. `router.test.ts` keeps both out of `PUBLIC_OPERATIONS`. Output tests: `course.view` returns the default and a custom text; the enrolment outputs carry the state and still never carry `orderId`.
