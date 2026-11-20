# Contract: portal screens

Buttons carry text labels only (no arrow icons). Every screen below gets an e2e `screenshot()`.

## Instructor portal

### Course editor: assignment row

- `-components/course/course-modules.tsx`: an upload assignment's row gains a "Submissions" link, with the waiting count when non-zero, to `/my-courses/$courseId/assignments/$contentItemId/submissions`.

### Submissions list: `routes/_authenticated/my-courses_/$courseId_/assignments/$contentItemId/submissions/index.tsx`

- Header: the assignment title, "Out of N points", the due date, a "Back to course" button.
- Count chips: Waiting, Resubmission requested, Returned, Not submitted.
- Table columns: Student · Status · Submitted (relative "3 days ago", plus a "Late" badge) · Version · Points.
- Rows link to the review page. "Load more" pages through the results (the `PagedList` pattern).
- "No longer enrolled" rows show a muted badge.
- States: loading, empty ("No students are enrolled yet"), error (`ErrorAlert`).
- `segmentLabels` gains `assignments` and `submissions`. The page sets its breadcrumb with `useBreadcrumbLabel(assignment title)`.

### Review page: `…/submissions/$userId.tsx`

- Left (wide screens) or top (narrow): the preview.
  - A PDF renders with react-pdf, loaded with a dynamic import, with page navigation and a "Download" button.
  - An image renders as `<img>`.
  - Any other type shows the file's details with "Download".
  - If rendering fails: "This file can't be previewed" plus "Download".
- Right or bottom: the submission's details (submitted, late, version), then the grading form:
  - Points (number input, "out of N"), Feedback (`RichTextEditor`).
  - Buttons: "Return" (final), "Request resubmission" (shown only when the state is `submitted`; it requires feedback).
  - When returned: the current grade with "Edit grade", which opens the same form and submits through `amendGrade`.
  - Not-enrolled students: the form is replaced by "This student has left the course. Their work can be read but not graded."
- Feedback history: a list of earlier rounds, newest first, each with its kind, version, date, giver and points.
- Unsent draft (FR-010): `lib/grading-draft.ts` keeps points and feedback under `discava:grading-draft:{courseId}:{contentItemId}:{userId}`, wrapped in try/catch, and cleared on a successful send.
- `CONFLICT`: a toast with the server's message, then a refetch. The draft is kept so nothing typed is lost.

### Home page: grading queue (Story 5)

- `routes/_authenticated/index.tsx` gains a "Waiting for grading" section with the total, up to 10 rows (student · assignment · course · waited), and each row linking to its review page.
- With nothing waiting: "Nothing is waiting for grading."
- The heading and text must not use the strings that `packages/e2e/src/scenarios/instructor-home.e2e.ts` forbids ('Open grading queue', 'Needs attention', 'Recent activity', 'Upcoming', '33 submissions').

## Student portal: `routes/learn/$courseId/-components/assignment-item.tsx`

| State | Shows |
|---|---|
| `submitted` | As today: submitted time, version, Late badge, file and Download, "Resubmit" |
| `resubmission_requested` | A notice "Your instructor asked you to resubmit", the newest request's feedback (`RichTextView`), the current file, and the resubmit form open by default |
| `returned` | "Returned" with **points / pointsOutOf**, the feedback, returned date ("updated" with its date when amended), the file, no form |
| any state with earlier rounds | "Earlier feedback", collapsed, newest first |
