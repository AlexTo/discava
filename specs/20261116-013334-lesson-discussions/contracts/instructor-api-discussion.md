# Contract: instructor-api `discussion` router

All are `courseProcedure`s (`protectedProcedure`: `UNAUTHORIZED` without a user, `FORBIDDEN` outside the `instructor` group, plus the table plugin). Each also requires a `courseInstructor` record for the caller and the named course, else `FORBIDDEN` (and `NOT_FOUND` for a course that does not exist), the way other course procedures check it. Any course status is allowed, including archived. They use `discussionWrites` for writes and do not use the lifecycle helpers that refuse edits to archived courses.

`DiscussionPost` is the type of [core-api-discussion.md](./core-api-discussion.md); instructors always get full content (a deleted post has no text) and `reportCount`.

## `discussion.unanswered` (query)

Input: `{ courseId: string; cursor?: string }`. Output: `{ items: (DiscussionPost & { lessonTitle: string })[]; cursor?: string }`, the `byUnanswered` index, oldest first, 20 per page. `lessonTitle` is read for the page's distinct lessons by key. Includes questions of archived or hidden lessons (the title is shown with the lesson's state).

## `discussion.reported` (query)

Input: `{ courseId: string; cursor?: string }`. Output: the same shape from the `byReported` index: questions and replies, each with `threadId`, `lessonTitle` and `reportCount`, oldest first.

## `discussion.hide` and `discussion.unhide` (mutations)

Input: `{ courseId, moduleId, lessonId, threadId, postId }`. Output: the post. Hide: only a `shown` post, else a no-op if already hidden, `NOT_FOUND` if deleted. Unhide: only a `hidden` post; refused with `PRECONDITION_FAILED` when it is a reply and the question already has 500 shown replies. Updates the question's counts and answered state in the same transaction (`discussionWrites`).

## `discussion.remove` (mutation)

Same input and output. Deletes any post of the course (tombstone: text removed, final). Deleting a deleted post is a no-op.

## `discussion.dismissReports` (mutation)

Same input. Clears the post's reports and flag; a post with no reports is a no-op success.

## Lesson delete guard

`lesson.deletePermanently` (`procedures/lesson.ts`) first queries the lesson's questions (limit 1) and, when one exists, refuses with `PRECONDITION_FAILED` "This lesson has questions, so it can stay archived but cannot be deleted permanently", the same wording style as the student-activity refusal. The module and course delete paths that remove lessons apply the same check.

## Tests

`procedures/discussion.test.ts` (the `course.test.ts` pattern): each procedure is refused for a student, an instructor of another course and an admin not listed on the course; a post id from another course is `NOT_FOUND` and leaks nothing; queues exclude hidden and deleted questions and include archived lessons; hide and unhide keep counts, and the accepted answer and `unanswered` flag are right after hiding the accepted reply or the only instructor reply; unhide past 500 is refused; the lesson delete guard case.
