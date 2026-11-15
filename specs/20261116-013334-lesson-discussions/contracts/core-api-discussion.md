# Contract: core-api `discussion` router

All are `protectedProcedure`s on the table plugin (any signed-in user), run on the shared router Lambda and are not in `PUBLIC_OPERATIONS`. The caller is always `ctx.user.sub`; no input names another user. Every procedure first runs `requireDiscussionAccess` (`helpers/discussion-access.ts`):

| Caller | Result |
|--------|--------|
| No course, or a draft or archived course the caller cannot see (not enrolled, not an instructor) | `NOT_FOUND` |
| Published course, caller not enrolled or dropped, not an instructor of it | `FORBIDDEN` "Enrol in the course to view it" (as `requireEnrolment`) |
| Student with a non-dropped enrolment | allowed; the module and lesson must be shown (`isShown`), else `NOT_FOUND` "This lesson is not available" |
| In the `instructor` group with a `courseInstructor` record for the course | allowed on any lesson record that exists, whatever its state or the course's |

The access result carries `isInstructor`. Writes then run `discussionWrites` (the course must be published, the module and lesson shown, checked in the transaction: a failure is `PRECONDITION_FAILED` "Questions are closed for this lesson" after the re-read decides which condition failed).

Shared input `LessonRef`: `{ courseId, moduleId, lessonId }`. A `moduleId` that does not match the lesson is `NOT_FOUND`.

## Post as returned (`DiscussionPost`)

```ts
{
  postId: string; threadId: string; kind: 'question' | 'reply';
  state: 'shown' | 'hidden' | 'deleted';
  // present only when the caller may see the post's content (state shown, or an instructor on a hidden post):
  authorName?: string; authorIsInstructor?: boolean; title?: string; body?: string;
  createdAt?: string; voteCount?: number;
  replyCount?: number; accepted?: boolean; answered?: boolean;   // questions: accepted = has an accepted answer
  upvotedByMe?: boolean; mine?: boolean;
  reportCount?: number;      // instructors only; never the reporters
}
```

A `hidden` or `deleted` post gives a student only `postId`, `threadId`, `kind`, `state`. A deleted post has no `title` or `body` for anyone.

## `discussion.listQuestions` (query)

Input: `LessonRef & { cursor?: string }`. Output: `{ items: DiscussionPost[]; cursor?: string }`, newest first, 20 per page. `upvotedByMe` comes from a batch of keyed gets for the page's questions. Students see hidden and deleted questions as placeholders (so the list does not reveal gaps), instructors see hidden ones in full.

## `discussion.thread` (query)

Input: `LessonRef & { threadId: string; cursor?: string }`. Output: `{ question: DiscussionPost; accepted?: DiscussionPost; replies: DiscussionPost[]; cursor?: string }`; replies oldest first, 50 per page, the accepted reply returned separately (and left out of `replies`). A student opening a hidden or deleted question gets the placeholder question and no replies. A `threadId` that is not a question of that lesson is `NOT_FOUND`.

## `discussion.ask` (mutation)

Input: `LessonRef & { postId: string; title: string; body: string }`. Output: the created `DiscussionPost`. Trims; title 1 to 120 and body 1 to 4,000 or `BAD_REQUEST` naming the field. `postId` must be a UUID v7 within 10 minutes of the server clock or `BAD_REQUEST`. A retry with an existing `postId` by the same author returns the existing question unchanged; the same id by another user is `CONFLICT`. Records `authorName` (`learnerName`) and `authorIsInstructor` from the access result.

## `discussion.reply` (mutation)

Input: `LessonRef & { threadId: string; postId: string; body: string }`. Output: the created reply. As `ask`; additionally `NOT_FOUND` if the question does not exist or is not shown (a student cannot tell which), `PRECONDITION_FAILED` "This question has reached its reply limit" at 500 visible replies. Phase 7 adds the `discussion.reply` notification items to the same transaction.

## `discussion.vote` (mutation)

Input: `LessonRef & { threadId: string; postId: string; voted: boolean }`. Output: `{ voteCount: number; upvotedByMe: boolean }`. Setting the state it already has is a no-op success. Voting on one's own post is `FORBIDDEN`; on a post that is not shown, `NOT_FOUND`.

## `discussion.accept` (mutation)

Input: `LessonRef & { threadId: string; postId: string | null }` (`null` removes the accepted answer). Output: the question. Allowed for the question's author or an instructor of the course, else `FORBIDDEN`. The reply must be a shown reply of that question, else `NOT_FOUND`. Accepting the already accepted reply is a no-op. Phase 7 adds `discussion.accepted` and `discussion.answered` items.

## `discussion.report` (mutation)

Input: `LessonRef & { threadId: string; postId: string }`. Output: `{ reported: true }`. Own post is `FORBIDDEN`; not shown is `NOT_FOUND`; repeating, or reporting past 20 reporters, succeeds without a change.

## `discussion.removeOwn` (mutation)

Input: `LessonRef & { threadId: string; postId: string }`. Output: the post as a placeholder. Only the author, else `FORBIDDEN`; deleting a deleted post is a no-op; deleting a hidden post is allowed. Does not need the course published or the lesson shown, only the caller's access to the course.

## Tests

`procedures/discussion.test.ts` with the access matrix on every procedure (anonymous is `UNAUTHORIZED` through `router.test.ts`; not enrolled, dropped, enrolled, instructor of the course, instructor of another course, student of a hidden lesson), the placeholders for hidden and deleted posts, retries, the 500 limit, own-post rules, and that the table is always called with `ctx.user.sub`.
