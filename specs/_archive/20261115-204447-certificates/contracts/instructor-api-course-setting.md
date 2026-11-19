# Contract: instructor-api course certificate setting

`course.setCertificates` (mutation, `courseProcedure`: instructor group plus course-instructor check as other course edits)

Input: `{ courseId: string; enabled: boolean }`

Output: the course as the other course mutations return it, including `certificatesEnabled: boolean` (always present: it is required in storage).

- Writes `certificatesEnabled` and moves `course.updatedAt` and each instructor's `courseUpdatedAt` the same way other course edits do (see the existing `instructor-course-updated-at` invariant).
- Allowed in any course status.
- Not instructor of the course: `FORBIDDEN`/`NOT_FOUND` as the other course mutations.
- Changing it never touches existing certificates, and does not backfill.
- The course read procedures the instructor portal uses return `certificatesEnabled`.
