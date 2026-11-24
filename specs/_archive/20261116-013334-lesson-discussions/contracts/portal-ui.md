# Contract: Portal UI

Text-only buttons (no arrow icons), as the repository requires. All post text (titles, bodies, names, excerpts) renders as text through `PostText` (preserved line breaks, wrapped long words), never as HTML. Shared presentational components live in `packages/common/shadcn/src/discussion/` (`PostCard`: author name, Instructor badge, time, text, upvote count, state placeholders; `PostText`); each portal's containers call its own API client.

## Student portal: lesson page

Files under `packages/websites/student-portal/src/routes/learn/$courseId/-components/discussion/`: `questions-section.tsx` (list, load more, ask form), `question-form.tsx`, `thread-view.tsx` (replies, reply form), rendered by `lesson-page.tsx` after the lesson's items. The query keys include course and lesson; lists refetch when the window regains focus.

| State | Shows |
|-------|-------|
| Loading | Skeleton rows |
| Empty | A card "Questions" with "No questions yet. Ask the first one." and the ask form |
| Questions | Per question: title, "<name> asked <relative time>" (absolute time on hover), an "Instructor" badge for instructors, reply count, "Answered" when it has an accepted answer, upvote count; opening one shows the thread |
| More | "Load more" while a cursor is present, disabled while loading |
| Course archived | The lists and threads read-only: no ask form, reply form, upvote, report or accept controls (deleting one's own post stays), with the note "This course is archived, so questions are read-only." |
| Placeholder posts | "This post was hidden by an instructor." or "This post was deleted." in place of a post, nothing else |
| Error | A short message and "Try again"; the rest of the lesson page still works |

Ask form: title (120 max with a live count) and details (4,000 max); the post id is minted when the form opens (`newPostId`) and kept across failed attempts and renewed after success; "Post question" is disabled while posting or while either field is empty; an error keeps what was typed. Reply form: details only, same id rule, "Post reply". Per post: "Upvote" / "Remove upvote" (not on one's own post), "Report" (not on one's own; "Reported" afterwards), "Delete" (own, with a confirmation naming what is deleted); on a question "Mark as answer" / "Remove answer" on a reply for the question's author. Reply limit and closed-lesson errors show the server's message.

A lesson that students cannot open (hidden or archived) has no section: they cannot reach it (spec Clarifications).

## Instructor portal: Questions

A route `my-courses_/$courseId_/questions/route.tsx` (the `my-courses_` pattern keeps it a sibling of the course page rather than nesting under it; the task confirms against the route tree) with a "Questions" link from the course page. Files under `.../questions/-components/`. Three views in tabs; each is a keyed, paged list with "Load more", an empty state and "Try again" on error.

- **Unanswered**: from `discussion.unanswered`, oldest first; each row: title, lesson title (with "archived" or "hidden" when the lesson is), author, age, reply count. Empty state: "All questions are answered."
- **Reported**: from `discussion.reported`; each row: the post text, kind, author, lesson, "<n> reports", and the actions "Hide", "Delete", "Dismiss reports" (delete with a confirmation).
- **By lesson**: pick a lesson (the course's lessons from the course read, with state labels), then all its questions from core-api `discussion.listQuestions`; read-only for a lesson that is archived or hidden (no reply form).

Opening a row shows the thread (core-api `discussion.thread`) with the reply form, "Mark as answer" on any reply, and, on every post, "Hide" or "Unhide" and "Delete". Hidden posts show their text with a "Hidden" label. Replying is disabled with an explanation for an archived course or a lesson that is not shown. Replies by the instructor carry the Instructor badge.

## Tests

Component tests beside each file (the portals' existing pattern with Testing Library, `renderWithCoreApi` and `renderWithInstructorApi`): every state above, the retry keeps the post id, placeholders show no text, own-post controls, read-only for an archived course, markup in a title shows as text, and no arrow icons in buttons. The thread's accepted answer is shown first and not repeated.
