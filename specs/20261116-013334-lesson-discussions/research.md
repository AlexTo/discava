# Research: Q&A and Discussion Threads per Lesson

## R-1: One entity for questions and replies

**Decision**: `discussionPost` with `kind`, pk `courseId`, sk `kind, lessonId, threadId, postId`.

**Rationale**: The two staff queues (unanswered questions, reported posts) must cover both kinds with one index each, and sparse flags on one entity do that. Putting `kind` first in the sort key makes "a lesson's questions" and "a thread's replies" separate contiguous ranges, so listing questions never reads replies. A question's `postId` equals its `threadId`, so a question is one keyed get.

**Alternatives**: two entities (the reported queue would need two indexes or two queries merged by hand); replies under the question's sort key (`lessonId, threadId, postId` with the question first): listing a lesson's questions would read every reply and filter, which constitution V rules out for a user request.

## R-2: Counters and the answered state

**Decision**: Counters are atomic adds inside the same transaction as the post that changes them, guarded by state conditions (`state = shown`, `replyCount < 500`). Operations that recompute `unanswered` or `acceptedPostId` condition on the values they read and the procedure retries on cancellation (at most 3, then `CONFLICT`).

**Rationale**: Concurrent replies and votes are the common case and must not conflict, so they use atomic adds. Recomputing the answered state needs a consistent view of three values, so those operations are optimistic. Both live in one helper so no procedure reasons about it (constitution IV).

**Alternatives**: a version attribute on every question (every reply would conflict with every other); computing counts at read time (a query of all replies per list item); recomputing counts in a stream handler (eventually consistent counters, a third consumer of the stream).

## R-3: Staff queues as sparse entries of existing indexes

**Decision**: `byUnanswered` on `gsi2` (pk `courseId`, `unanswered`; sk `threadId`) and `byReported` on `gsi1` (pk `courseId`, `reported`; sk `postId`), each with a `condition` so only flagged records are written.

**Rationale**: Constitution V allows an index only for a named pattern and counts its write cost; these are the two the issue names (unanswered per course, moderation). The indexes already exist on the table, and `contentItem.byTranscodePending` is the precedent for a conditional (sparse) entry, so no table definition changes and only flagged records cost an index write. Oldest first suits both: the longest-waiting question is at the top.

**Alternatives**: a new GSI (a table migration for two patterns); querying a lesson's questions across all lessons and filtering (a read of everything per page); a `status` sort key on the primary index (a question's key would change when it is answered, which is a delete and a put).

## R-4: Votes as records keyed by voter

**Decision**: `discussionVote`, pk `courseId, userId`, sk `lessonId, threadId, postId`; vote and unvote are a create or delete plus the post's `voteCount ± 1` in one transaction.

**Rationale**: One vote per person per post is enforced by the key and a `not exists` condition, so a double click or two devices count once. "Which of these did I vote on" is one keyed query for a thread, or a batch of keyed gets for a page of questions.

**Alternatives**: a set of voter ids on the post (unbounded growth); counting vote records at read time.

## R-5: Reports as a capped set on the post

**Decision**: `reportedBy` is a set of at most 20 user ids on the post, with a sparse `reported` flag. At 20, a further report succeeds without writing. Dismissing clears both.

**Rationale**: The moderation need is "this post was flagged, by about how many". Twenty reporters is far beyond what makes a decision different, and it keeps reports out of a third entity and a third invariant family. Reporter ids are never returned.

**Alternatives**: a `discussionReport` entity per reporter (unbounded, resolving needs a batch); a bare counter (the same person could report repeatedly).

## R-6: Hide is a flag, delete is a tombstone

**Decision**: `state` is `shown`, `hidden` or `deleted`. Both keep the record; delete removes `title`, `body` and the reports and is final. Replies under a hidden or deleted question stay stored but are not shown to students.

**Rationale**: Keeping the record keeps threads, counts and the accepted answer coherent, and keeps invariants simple (a reply's question always exists). Hard delete would need a cascade of up to 500 replies and votes, over the 100-item transaction limit.

**Alternatives**: hard delete with a batch cascade; deleting only the text of a hidden post.

## R-7: Where procedures live, and how an instructor is recognised

**Decision**: core-api `discussion` holds everything students and instructors both do. Its access helper accepts a caller who is in the `instructor` group and has a `courseInstructor` record for the course (any course status), otherwise requires a non-dropped enrolment with the existing `requireEnrolment`. instructor-api `discussion` holds only the staff-only operations. Both call `discussionWrites`.

**Rationale**: CLAUDE.md puts procedures that only instructors may call in instructor-api and procedures any authenticated user can call in core-api. Replies, reads and accepting are shared, so duplicating them in two APIs would duplicate the rules; the helper keeps the rule in one place either way. The instructor portal already calls core-api (its course list does), so it reuses the same read calls.

**Alternatives**: all procedures in core-api with a group check on the staff ones (breaks the separation CLAUDE.md describes, and instructor-api's own CORS and authorizer config); all in instructor-api (students cannot call it).

## R-8: Visibility and archived content

**Decision**: Reads follow the lesson: a student needs a non-dropped enrolment and a shown module and lesson (`isShown`, as every student read); an instructor needs only the lesson record to exist. Writes need course `published` and module and lesson shown, in the transaction. Moderation needs only the caller's access to the course.

**Rationale**: "Archived lessons keep their threads readable" is met by keeping every record and letting instructors read them, since students cannot open an archived lesson at all. Adding a student surface for lessons they cannot see would contradict the rule that students see only effectively visible content (`filterEffectivelyVisible`). Restoring a lesson restores the section with no work. Open question for the maintainer in the PR.

**Alternatives**: let students read threads of archived lessons by id (leaks that the lesson exists and contradicts the visibility rule); copy threads somewhere on archive (data duplication for nothing).

## R-9: Client-minted post ids

**Decision**: The form mints a UUID v7 when it opens and keeps it across retries; the server accepts it only if it is a v7 whose time is within 10 minutes of its clock, derives `createdAt` from it and creates the post only if the id is new.

**Rationale**: The same approach as announcements (#282) and the only way a retry after a timeout cannot duplicate a post without a separate dedupe table. The time bound stops a client placing a post far in the past or future in a time-sorted list.

**Alternatives**: server-generated ids (a retry duplicates); a separate idempotency record (another entity for a small gain).

## R-10: Notifications

**Decision**: Phase 7 adds `discussion.answered` and `discussion.accepted` to the notifications registry (the spec's own rule: a type is one entry plus a test), reuses the existing `discussion.reply`, and builds the items with `notificationWrites` inside the post's transaction. Dedupe keys: reply `<postId>`; accept `<threadId>:<postId>` (so accept, unaccept, accept again does not notify twice). `occurredAt` is the post's `createdAt` for a reply and the accepting request's time for an acceptance. The link opens `/learn/<courseId>/lesson/<lessonId>`.

**Rationale**: The notification must succeed or fail with the post, which is exactly what the helper's transaction items are for. The v1 registry has no thread id param, so the link can only open the lesson (risk R4); adding a `threadId` param later is one registry change and a lesson-page search parameter. Notifying only the people involved avoids needing subscriptions; instructors learn of questions through the queue.

**Alternatives**: a stream handler publishing after the fact (a second consumer of the table stream, and a post could exist without its notification); notifying every participant (needs subscriptions and a fan-out); an announcement-style class broadcast (noise).

## R-11: Plain text and excerpts

**Decision**: Bodies and titles are plain text with line breaks, rendered as text with preserved newlines and wrapped long words. The notification excerpt is the first 140 characters of the body with an ellipsis.

**Rationale**: No markup means no sanitising surface. Rich text is a later change that can be added without changing keys.

**Alternatives**: the shared rich-text editor (formulas and lists, but a stored-JSON validation and rendering surface for every post, and the announcements spec already carries that cost).

## R-12: Protecting lessons that have posts

**Decision**: instructor-api's permanent lesson delete (and the module delete path that removes lessons) queries `discussionPost` for the lesson (limit 1) and refuses with `PRECONDITION_FAILED` and a message that the lesson can stay archived. A new invariant check (`discussion-thread-links`) catches any post whose lesson is gone.

**Rationale**: Without it, deleting an archived lesson orphans its threads. A post can only be created while the lesson is shown, and a lesson can only be permanently deleted once archived, so a post cannot race into a lesson being deleted.

**Alternatives**: cascading the delete to the posts (over transaction limits, and deletes student content); counting posts on the lesson (a counter another writer must maintain).

## R-13: Where the UI lives

**Decision**: The student's Questions section is a component of the lesson page. The instructor's Questions area is a route beside the course page (`my-courses_/$courseId_/questions`), with a link from the course page. Presentational post components used by both portals go in `common-shadcn`; limits and the id minting function in `common-web-utils/discussion`.

**Rationale**: CLAUDE.md: UI shared by portals goes in `common-shadcn`, non-UI code shared by two or more portals in `common-web-utils`, and each portal's containers, which know its API client, stay in the portal.

**Alternatives**: a single thread component in `common-shadcn` that takes the API client (it would then know the tRPC client); duplicating the card in each portal.
