# Contract: instructor-api `analytics` router

All procedures build on instructor-api's `protectedProcedure` (caller in the `instructor` group), and each course-scoped one then requires the caller to be an instructor of that course (a `courseInstructor` record for `ctx.user.sub`), else `FORBIDDEN`. A course that does not exist and a course the caller does not teach answer the same (`NOT_FOUND`), so ids cannot be probed. Inputs and outputs are zod schemas in `instructor-api/src/schema/analytics.ts`.

## `analytics.courseSummaries`

Input: none. Output: one entry per course the caller teaches (draft, published and archived), most recently updated first:

| Field | Meaning |
|-------|---------|
| `courseId`, `title`, `status` | from the course record |
| `enrolments` | all-time enrolments |
| `activeThisWeek` | learners active in the current UTC calendar week |
| `completionRate` | `completed / (enrolments - dropped)` as a whole percent rounded down, or `null` when the denominator is 0 |
| `updatedAt` | `courseStats.updatedAt`, or `null` when nothing has happened |

Cost: the instructor index query, plus one batch get of summaries and one of this week's period items. Independent of enrolment size.

## `analytics.course`

Input: `{ courseId, days: 30 | 90 }` (default 90). Output:

- `totals`: `enrolments`, `active` (not completed, not dropped), `completed`, `dropped`, `completionRate`, `activeThisWeek`, `updatedAt`
- `daily`: exactly `days` entries, oldest first, each `{ date, enrolments, activeLearners }`, zero filled
- `lessons`: lessons currently shown to students (not hidden or archived, nor in a hidden or archived module), in course order, each `{ lessonId, moduleId, title, started, completed, completionShare }` (`completionShare` is `null` when `started` is 0)
- `quizzes`: `{ contentItemId, lessonId, title, students }` for every shown quiz item, for use with `analytics.quiz`

## `analytics.quiz`

Input: `{ courseId, contentItemId }`. Output:

- `questions`: the quiz's current questions, each `{ questionId, text, attempts, misses, missRate, ranked }`, with `ranked` true when `attempts >= 5`; ranked questions come first by `missRate` descending, ties by `attempts` descending, then the unranked in quiz order
- `scoreBands`: ten `{ from, to, students }`, 0-9 through 90-100
- `students`: total students with a best score (sum of the bands)

The quiz must belong to the course, else `NOT_FOUND`.

## Errors

| Case | Code |
|------|------|
| Caller not in the `instructor` group | `FORBIDDEN` |
| Not an instructor of the course, or no such course | `NOT_FOUND` |
| `days` not 30 or 90, malformed id | `BAD_REQUEST` |

## Not exposed

No student identifiers appear in any output (FR-014), and there are no write procedures: only the analytics handler and the rebuild tooling write aggregates.
