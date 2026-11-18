# Data Model: Q&A and Discussion Threads per Lesson

## `discussionPost` (new entity, `packages/databases/core-table/src/entities/discussion-post.ts`)

One record per question and per reply. Questions and replies share an entity so the two staff queues are sparse indexes over both.

| Attribute | Type | Notes |
|-----------|------|-------|
| `courseId`, `lessonId`, `moduleId` | string, required, read-only | `moduleId` is carried so a write can `check` the module without a lookup |
| `kind` | `question` or `reply`, required, read-only | |
| `threadId` | string, required, read-only | the question's id; for a question it equals `postId` |
| `postId` | string, required, read-only | UUID v7 minted by the client and validated (see rules) |
| `authorId` | string, required, read-only | the Cognito `sub`; kept after a delete |
| `authorName` | string, required, read-only | `learnerName(user)` when posted; never the email |
| `authorIsInstructor` | boolean, required, read-only | the badge, as at posting |
| `title` | string | questions only, 1 to 120; removed on delete |
| `body` | string | 1 to 4,000, plain text; removed on delete |
| `state` | `shown`, `hidden` or `deleted`, required, default `shown` | `deleted` is final |
| `replyCount` | number, default 0 | questions only: replies with `state = shown`, at most 500 |
| `instructorReplyCount` | number, default 0 | questions only: shown replies with `authorIsInstructor` |
| `voteCount` | number, default 0 | upvotes on this post |
| `acceptedPostId` | string | questions only; a shown reply of this question; removed when the question is deleted (kept while it is hidden) |
| `reportedBy` | string set | at most 20 user ids; absent when no open reports |
| `unanswered`, `unansweredSince` | string | questions only; `unanswered` is the `courseId`, set exactly while the question is `shown`, has no `acceptedPostId` and `instructorReplyCount = 0` |
| `reported`, `reportedSince` | string | `reported` is the `courseId`, set exactly while `reportedBy` is non-empty; `reportedSince` is when it was first reported |
| `createdAt` | string (ISO), required, read-only | the time part of `postId` |
| `updatedAt` | as other entities | |

**Indexes** (access patterns, constitution V):

| Pattern | Key | Used by |
|---------|-----|---------|
| One question or reply by id | primary: pk `courseId`, sk `kind`, `lessonId`, `threadId`, `postId` | every write; open a thread |
| A lesson's questions, newest first, paged | primary, `kind = question`, `lessonId`, descending | `discussion.listQuestions`, instructors' By lesson |
| A thread's replies, oldest first, paged | primary, `kind = reply`, `lessonId`, `threadId`, ascending | `discussion.thread` |
| Does a lesson have any post (delete guard) | primary, `kind = question`, `lessonId`, limit 1 | instructor-api permanent lesson delete |
| A course's unanswered questions, oldest first | `byUnanswered` on `gsi2pk-gsi2sk-index`, sparse: pk `unanswered` (the courseId); sk `unansweredSince` | `discussion.unanswered` |
| A course's reported posts, oldest first | `byReported` on `gsi1pk-gsi1sk-index`, sparse: pk `reported` (the courseId); sk `reportedSince` | `discussion.reported` |

Both indexes use `condition` so only flagged records are written to them, as `contentItem.byTranscodePending` does. Each index is built only from attributes that are not part of the primary key, as `byTranscodePending` is: `unanswered` and `reported` hold the `courseId` (not a marker), and `unansweredSince` / `reportedSince` (set and removed with them) order the queue oldest first. ElectroDB re-evaluates an index's `condition` only when a write provides one of that index's composites, so updating a counter, the body or the state leaves both queues' keys alone; a test pins this. Putting `courseId` or `threadId` in these keys instead makes every update drop a flagged post from both queues, and every create demand both flags. The writer sets a flag and its `...Since` together, and removes both together (which clears that queue's keys).

## `discussionVote` (new entity, `.../entities/discussion-vote.ts`)

| Attribute | Type | Notes |
|-----------|------|-------|
| `courseId`, `userId` | string, required | the voter is the caller, never an input |
| `lessonId`, `threadId`, `postId` | string, required | the post voted on |
| `createdAt` | string (ISO) | |

Primary key: pk `courseId`, `userId`; sk `lessonId`, `threadId`, `postId`. "Did I vote here" for a lesson's page of questions is a batch of keyed gets (one per question on the page); for one thread it is one query on sk prefix `lessonId`, `threadId`. One vote per person per post is the key itself.

## Rules and where they live

`discussionWrites(entities, op)` in `helpers/discussion.ts` is the only writer of both entities. It returns the items of one transaction; the caller adds notification items (Phase 7) and runs it. Every operation includes the same first three items, as `studentActivityWrites` does: `course.check` (`status = published`), `module.check` and `lesson.check` (visible and not archived), except the moderation operations (hide, unhide, delete, dismiss) which include none of them (spec FR-002).

| Operation | Items beyond the checks |
|-----------|--------------------------|
| `ask` | `post.create` (question; condition: not exists) |
| `reply` | `question.patch`: `replyCount + 1` (and `instructorReplyCount + 1` for an instructor; remove `unanswered` for an instructor reply), condition `state = shown` and `replyCount < 500`; `post.create` (reply) |
| `vote` / `unvote` | `vote.create` (not exists) or `vote.delete` (exists); `post.patch`: `voteCount ± 1`, condition `state = shown` and, for a vote, `authorId <> voter` |
| `accept` / `unaccept` | `question.patch`: set or remove `acceptedPostId` (condition: still the value read; for accept the reply is a shown reply of the question, checked with a `reply.check`); recompute `unanswered` (removed on accept; restored on unaccept when `instructorReplyCount = 0`, condition on the read count) |
| `hide`, `unhide`, `delete` | `post.patch` of `state` (condition: the state read); for a reply, `question.patch`: `replyCount ∓ 1`, and `instructorReplyCount ∓ 1` for an instructor's reply, with `acceptedPostId` removed if it was this reply, `unanswered` recomputed, each conditioned on the values read; for a question, `unanswered` removed (hide, delete) or recomputed (unhide). Deleting a question also removes `acceptedPostId`, `title`, `body`, `reportedBy` and `reported`, so nothing derived from the accepted answer survives (the "Accepted answer" mark is read from `acceptedPostId`, and notifications already sent are not retracted); hiding a question keeps `acceptedPostId`, and unhide restores the question as it was. Deleting any post removes its `reportedBy` and `reported` too. Unhide of a reply is refused when `replyCount` is already 500 |
| `report` | `post.patch`: add the reporter to `reportedBy` (condition: `state = shown`, author is not the reporter, `size(reportedBy) < 20` or reporter already in it), set `reported`. At 20, a further report returns success without a write |
| `dismiss` | `post.patch`: remove `reportedBy` and `reported` (condition: still reported) |

A cancelled transaction is re-read and retried up to three times by the procedure, then `CONFLICT`, as the assignment and announcement procedures do; the precise reason (full thread, hidden meanwhile, not allowed) is decided on the re-read.

**Post ids.** `newPostId()` (web-utils) mints a UUID v7 when a form opens. The helper accepts an id only if it is a UUID v7 whose time part is within 10 minutes of the server clock, sets `createdAt` from it, and creates only if the id is new. A reply's `threadId` must name an existing question of the same lesson (the `question.patch` condition fails otherwise).

**Answered state.** `answeredState({ state, acceptedPostId, instructorReplyCount })` is the one pure function that says whether a question is unanswered; the operations and the invariant both call it.

**Display rules** (in core-api's mapper, tested): a `hidden` or `deleted` post gives students only `{ postId, state }` (no name, time, counts or text); instructors get everything except that a deleted post has no text. `reportedBy` is never returned; instructors get `reportCount`.

## Invariants (`helpers/invariants.ts`, snapshot gains `discussionPosts` and `discussionVotes`)

1. `discussion-post-shape`: kind-specific fields (a question has a title of 1 to 120 and `postId = threadId`; a reply has none of the question-only attributes), body of 1 to 4,000 unless `deleted` (then no title or body), `postId` is a UUID v7 and `createdAt` equals its time part, `authorName` present, `state` valid, `reportedBy` at most 20 and not containing the author.
2. `discussion-thread-links`: a reply's question exists with the same course, lesson and `threadId`; every post's lesson record exists (archived is fine) and its `moduleId` matches the lesson's.
3. `discussion-counts-match`: for each question, `replyCount` equals its replies with `state = shown`, `instructorReplyCount` equals those by instructors, both at most 500; for each post, `voteCount` equals its `discussionVote` records.
4. `discussion-accepted-valid`: `acceptedPostId`, if set, names a `shown` reply of that question, and the question is not `deleted`.
5. `discussion-unanswered-matches`: `unanswered` is set exactly when `answeredState` says unanswered, on questions only.
6. `discussion-votes-valid`: each vote's post exists, the voter is not the post's author, and the ids on the vote match the post's.
7. `discussion-reports-valid`: `reported` is set exactly when `reportedBy` is non-empty.

Each ships with a test that breaks it. Existing invariants unaffected: `activity-count-matches-students` and the `student-records-*` checks do not include discussion records, and a test pins that a student whose only records are posts and votes is not counted and trips none of them.
