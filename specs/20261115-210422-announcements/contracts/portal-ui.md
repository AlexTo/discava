# Contract: Portal UI

Text-only buttons (no arrow icons), as the repository requires. Bodies render only through `RichTextView` from `@discava/common-shadcn`; titles, author names and excerpts render as text.

## Student portal: course home

File: `packages/websites/student-portal/src/routes/learn/$courseId/-components/announcements.tsx`, rendered by `course-home.tsx` above the outline.

| State | Shows |
|-------|-------|
| Loading | Skeleton rows |
| Empty | A card "Announcements" with "Your instructor hasn't posted anything yet." |
| Items | A card "Announcements"; per item: title, "<author> posted <relative time>" (with the absolute time on hover), "edited" with the edit time when `editedAt` is set, and the `RichTextView` body |
| More | A "Load more" button while `cursor` is present; disabled while loading |
| Error | A short message and a "Try again" button; the rest of the course home still works |
| Body that fails to render | "This announcement could not be displayed." in that row only |

The query key includes `courseId`; the list is refetched when the window regains focus (like the course data), so a notification's link lands on current content. It is not shown on the public course page.

## Instructor portal: course page

Files under `packages/websites/instructor-portal/src/routes/_authenticated/my-courses_/$courseId/-components/announcements/`: `announcements-section.tsx` (list, load more, empty state "No announcements yet."), `announcement-form.tsx` (create and edit), `delete-announcement-dialog.tsx`. The section renders after "Course content" on the course page and, unlike the content, is not read-only for an archived course.

Create form:

- Title (required, 120 max with a live count) and the existing `RichTextEditor` (aria label "Announcement text").
- A note under it: "Posting notifies the students enrolled in this course." No count is shown.
- The announcement id is minted with UUID v7 when the form opens (and again after a successful post), and kept across failed attempts so a retry is the same post.
- "Post announcement" is disabled while posting or while title or text is empty; an error keeps the text and shows the server's message.
- For an archived course the form is replaced by "Archived courses can't have new announcements." and the list, edit and delete remain.

Edit: the same form prefilled, "Save changes", sends the version it read. A `CONFLICT` shows "This announcement changed. Reload to see the latest text." with a "Reload" button that refetches and keeps nothing silently overwritten.

Delete: "Delete" on each item opens a confirmation naming the title and saying "Students keep the notification they already received." The delete button is destructive-styled and disabled while running. A `NOT_FOUND` result is treated as already deleted and removes the row.

## Tests

Component tests beside each file (the portals' existing pattern with Testing Library): states above, the retry keeps the id, the conflict message, archived course hides the form, no arrow icons in buttons.
