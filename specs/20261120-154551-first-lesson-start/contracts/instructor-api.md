# Contract: instructor-api

## `course.setFirstLessonPrompt` (mutation)

Built on `courseInstructorProcedure`, like `course.setCertificates`: only an instructor of the course may call it, in any course status.

Input: `{ courseId, prompt }`, where `prompt` is a string or null.

| Case | Result |
|------|--------|
| 1 to 200 characters after trimming | `course.firstLessonPrompt` is set to the trimmed text |
| null, or blank after trimming | `course.firstLessonPrompt` is removed: the course uses the default |
| Longer than 200 characters | `BAD_REQUEST`, "The prompt must be at most 200 characters" |
| Not an instructor of the course | Refused as the other course procedures refuse |

Output: the course, as `course.setCertificates` returns it. It refreshes the instructor's course `updatedAt` the same way.

No enrolment is read or written: learners who closed the prompt are not asked again.

## Changed outputs

**`course.view`** gains `firstLessonPrompt?: string` (the course's own text, absent when it uses the default) and `defaultFirstLessonPrompt: string`.

**`analytics.course`**:

| Where | Field | Type | Notes |
|-------|-------|------|-------|
| `totals` | `activated` | count | Enrolments that have done a first thing |
| `totals` | `activationRate` | whole percent 0 to 100, or null | `activated / enrolments`, rounded down; null when `enrolments` is 0 |
| `totals` | `promptAnswered`, `promptDismissed` | count | |
| each `daily` item | `activated` | count | Of the enrolments made that day, how many are activated so far |

`analytics.courseSummaries` (the dashboard cards) is unchanged.

Counters are clamped at 0 on read like the others, and `activated` is never reported above `enrolments`.

## Tests

`course.test.ts`: every row of the first table; the view output with and without a custom text. `analytics.test.ts`: totals and daily items carry the new figures; `activationRate` is null with no enrolments and 33 for 1 of 3; a caller who does not teach the course still gets `NOT_FOUND`.
