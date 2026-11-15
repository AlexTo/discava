# Feature Specification: Q&A and Discussion Threads per Lesson

**Feature Branch**: `20261116-013334-lesson-discussions` (spec only; implementation PRs branch from `main`)

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "Issue #280, feat(discussion): Q&A and discussion threads per lesson. Learners get stuck; instructor/peer answers are a core Udemy/Coursera feature. Scope: questions and replies on each lesson, upvotes, mark answer accepted, instructor badge. Visible only to enrolled students and course instructors. Instructor view of unanswered questions per course. Moderation: report, hide, delete. Hooks into notifications (new reply, answered). Acceptance criteria: authorization tests for enrolled/non-enrolled/instructor; archived lessons keep their threads readable."

**Parent issue**: #280

**Depends on (in flight, not merged)**: the notifications spec ([`specs/20261115-204427-notifications/`](../20261115-204427-notifications/spec.md), PR #331, issue #281). Only the notification hooks (User Story 6) need it; every other story works without it. See [Dependency on the notifications spec](#dependency-on-the-notifications-spec).

## Dependency on the notifications spec

This feature is a producer of the notification pipeline. It uses, unchanged, the contract in the notifications spec's `contracts/producer-helpers.md`: the registered type `discussion.reply` (already in that spec's v1 registry), `notificationWrites` (so the notification joins the post's own transaction) and the registry's rule that adding a type is one entry plus a test. It adds two registry entries of its own (`discussion.answered`, `discussion.accepted`), as that contract allows. It does not write notification records, send email or check preferences.

Everything else (posting, reading, votes, acceptance, the unanswered queue, moderation, both portals) works with no notification code, so the task list puts the notification hooks in the last implementation phase, gated on the notifications spec's Phase 1 (entities and registry) and Phase 2 (producer helpers), and leaves the rest free to merge first.

Related in-flight specs, none of which this one depends on:

- **Announcements** ([`20261115-210422-announcements`](../20261115-210422-announcements/spec.md), #282): one-way, instructor-to-class posts on the course home, with rich text, edited and deleted by instructors only, notifying the whole class. Discussions are many-to-many, belong to one lesson, are plain text, and notify only the people involved. The two share no record, route or component; both are producers of the same pipeline.
- **Instructor dashboard** (#332): may later show an unanswered-question count. This spec's unanswered list is the one source it would read; nothing here waits for it.
- **Video player** (#330): out of scope here (no timestamped questions); a later feature can add an optional timestamp to a question.

## Clarifications

### Session 2026-11-16

Resolved without asking, using the defaults below (non-interactive run).

- Q: Is a post rich text or plain text? → A: Plain text with line breaks. A title (questions only) of 1 to 120 characters and a body of 1 to 4,000. No markup, images, files or links are interpreted, so nothing can run in a learner's browser. Rich text is a later change.
- Q: Who can read and write discussions? → A: Students whose enrolment is not `dropped`, and instructors listed on the course. Anyone else is refused the way the rest of the course's content refuses them (not found when the course is not visible to them, forbidden for a published course they are not enrolled in). Admins who are not listed on the course get no special access.
- Q: Where do instructors read and reply? → A: Replying and reading a thread use the same calls as students (an instructor is not required to be enrolled), and carry the instructor badge. Only the staff-only actions (the unanswered and reported queues, hide and unhide, deleting others' posts, accepting any reply) are instructor-only calls.
- Q: What counts as "unanswered"? → A: A question that is visible, not deleted, has no accepted answer and no visible reply from a course instructor. A student reply does not answer it ("me too" must not hide a question from the instructor).
- Q: What does "archived lessons keep their threads readable" mean for students, who cannot open an archived lesson? → A: The threads are kept whole and readable by instructors (the unanswered and per-lesson views), and they reappear unchanged for students if the lesson is restored. Students read a lesson's thread wherever they can open the lesson (including lessons of an archived course). No student surface is added for lessons students cannot already see. Open question for the maintainer in the PR.
- Q: Can posts be edited? → A: No, in this feature. An author deletes their own post and writes again. Editing adds history and moderation questions with little payoff for short Q&A.
- Q: Delete or hide: how do they differ, and are they permanent? → A: Hide is an instructor action, reversible: students see "This post was hidden by an instructor" in its place, and the instructor still reads it. Delete is permanent: the author (own posts) or an instructor (any post) removes the text, and everyone sees "This post was deleted". Deleted posts keep their place so replies and counts stay coherent; nothing is shown that was in the text.
- Q: What happens to the replies under a hidden or deleted question? → A: They are kept but not shown to students: a hidden or deleted question shows only its placeholder in the lesson list and cannot be opened by students. Instructors can open a hidden one and see everything.
- Q: Can someone vote on their own post, or vote twice? → A: No to both. One upvote per person per post, toggled off by pressing again; the author cannot upvote their own post.
- Q: Who can accept an answer, and how many? → A: The question's author or any instructor of the course; one accepted reply per question, changeable or removable. Only a visible reply of that question can be accepted.
- Q: How is a report handled? → A: Any reader except the author can report a post once; the post is flagged for instructors with the number of reporters (up to 20 reporters are remembered, later reports on an already heavily reported post succeed without being stored). A report never hides anything by itself. An instructor can hide, delete, or dismiss the reports (which clears the flag and the reporters; the post can be reported again).
- Q: Who is notified, and when? → A: A new reply notifies the question's author (never the replier). Accepting a reply notifies the reply's author (`discussion.accepted`) and the asker too (`discussion.answered`) unless the asker did the accepting. Nobody else (no thread subscriptions in v1). Hidden or deleted posts never notify.
- Q: Is posting a question or reply "student activity" for progress? → A: No. It does not count towards `studentActivityCount`, completion or `lastActivityAt`. Course content and progress behave exactly as before.
- Q: How big can a thread get? → A: A question takes at most 500 replies; the 501st is refused with a clear message. This bounds contention on the question's counters.
- Q: How does a retried post become one post? → A: The client mints the post's id (time-sortable) when the form opens and keeps it across retries; the server accepts it only when its time is within 10 minutes of the server clock and creates the post only if the id is new, as the announcements spec does.
- Q: What name and role does a post show? → A: The author's given and family name when posted (the shared learner-name rule: "Discava learner" if none, never the email) and whether they were a course instructor when posting. Both are recorded on the post and do not change when the user or the course later changes.
- Q: Do upvotes reorder replies? → A: No. Replies stay oldest first with the accepted answer pinned, and questions stay newest first. Upvotes are shown as a count only; ordering by votes would need another index for little gain at this size.
- Q: Can instructors browse all of a lesson's questions, or only the unanswered ones? → A: Both. The instructor Q&A has three views: Unanswered (the course queue), Reported (the moderation queue) and By lesson (pick a lesson, see all its questions, including those of archived or hidden lessons, read-only there). By lesson uses the same lesson list call students use.
- Q: Does a deleted or hidden post still show who wrote it? → A: Students see the placeholder only, with no author name, time or counts; instructors see the full post including its state. A deleted post keeps no text, but its author id stays on the record for the data-consistency checks.
- Q: Does the 500-reply cap count hidden and deleted replies? → A: No, only visible replies, enforced when a reply is posted or a hidden reply is unhidden (unhiding past 500 is refused). Hiding and unhiding therefore cannot be used to exceed it.
- Q: Can anyone write in an archived course? → A: No one: instructors too are refused, because an archived course is read-only (posting, replying, voting, reporting, accepting). Hide, unhide, delete and dismiss stay possible for instructors, so an archived course can be cleaned up, as announcements allow deleting there.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ask a question on a lesson (Priority: P1)

An enrolled student on a lesson page opens the Questions section, sees the lesson's questions newest first, and asks a new one with a title and details. It appears at the top for everyone allowed to read it.

**Why this priority**: Without questions there is nothing else to answer, vote on or moderate, and the read rule (enrolled students and instructors only) is a security requirement that ships with it.

**Independent Test**: As a student enrolled in a published course, ask a question on a visible lesson and check it is listed first with the student's name. Check a student of another course, a dropped student and an anonymous caller are refused when they list or ask.

**Acceptance Scenarios**:

1. **Given** an enrolled student on a visible lesson of a published course, **When** they post a question with a title and a body, **Then** it is saved and listed first for that lesson with their name, the time, no replies and no accepted answer.
2. **Given** the post request is retried after a timeout or a double click, **When** it reaches the server again, **Then** there is still one question.
3. **Given** a user who is not enrolled, a student who dropped the course, or an anonymous caller, **When** they try to list, read or post, **Then** the request is refused and nothing is written.
4. **Given** a lesson that is hidden or archived, or a module above it that is, **When** a student tries to post or list there, **Then** it is refused as for any content they cannot see.
5. **Given** a course that is not published (archived), **When** an enrolled student opens a lesson, **Then** they can read its questions but cannot post, vote, report or accept.
6. **Given** a title or body that is empty or too long, **When** the student posts, **Then** it is refused naming the problem and nothing is saved.
7. **Given** a title containing markup, **When** it is shown anywhere (the lesson, the bell, the unanswered list), **Then** it appears as text and nothing runs.
8. **Given** more questions than a page, **When** the student loads more, **Then** no question repeats or is skipped, even if a new one arrived meanwhile.

---

### User Story 2 - Reply and read a thread (Priority: P1)

A student or instructor opens a question and sees it with its replies, oldest first, the accepted answer (if any) pinned on top. They reply. Instructors' replies carry an Instructor badge.

**Why this priority**: Peer and instructor answers are the point of the feature, and the badge is named in the issue.

**Independent Test**: Reply as a classmate and as an instructor of the course (who is not enrolled) and check both appear in order, only the second with the badge, and that the reply count on the question rose by two.

**Acceptance Scenarios**:

1. **Given** a visible question, **When** an allowed reader replies with a body, **Then** the reply is saved, shown last, and the question's visible reply count rises by one.
2. **Given** an instructor of the course replies, **When** anyone reads the thread, **Then** the reply carries an Instructor badge, whether or not the instructor is enrolled as a student.
3. **Given** a question with an accepted answer, **When** the thread is read, **Then** that reply is shown first, marked "Accepted answer", and not repeated among the others.
4. **Given** a question with 500 replies, **When** another reply is posted, **Then** it is refused with a clear message.
5. **Given** two replies at the same moment, **When** both complete, **Then** both exist and the reply count is exactly two higher.
6. **Given** a reply is retried, **When** it reaches the server again, **Then** there is one reply.
7. **Given** a hidden or deleted question, **When** a student tries to reply or open it, **Then** it is refused or shows only the placeholder; an instructor opens a hidden one in full.
8. **Given** more replies than a page, **When** the reader loads more, **Then** none repeat or are skipped.

---

### User Story 3 - Upvote and accept an answer (Priority: P2)

A reader upvotes helpful questions and replies. The question's author, or an instructor, marks one reply as the accepted answer, which lifts it to the top and counts the question as answered.

**Why this priority**: Required by the issue and the main way good answers surface, but threads work without them.

**Independent Test**: Upvote as two students and check the count is two and a repeat press removes one; accept a reply as the asker, then as an instructor, and check only one is accepted at a time.

**Acceptance Scenarios**:

1. **Given** a visible post by someone else, **When** a reader upvotes it, **Then** its count rises by one and it shows as upvoted by them; pressing again removes it and lowers the count.
2. **Given** a post of their own, **When** the author tries to upvote it, **Then** it is refused.
3. **Given** two upvotes at the same moment from different readers, **When** both complete, **Then** the count is two higher; the same reader twice at once counts once.
4. **Given** a question and one of its visible replies, **When** the question's author or an instructor of the course accepts it, **Then** the question shows that accepted answer; accepting another replaces it.
5. **Given** a student who did not ask the question and is not an instructor, **When** they try to accept, **Then** it is refused.
6. **Given** an accepted reply that is later hidden or deleted, **When** the thread is read, **Then** the question has no accepted answer (and counts as unanswered again if no instructor reply remains).
7. **Given** a reply that belongs to a different question than the one named in the request, **When** it is accepted, **Then** nothing is found.

---

### User Story 4 - Instructor works through unanswered questions (Priority: P1)

An instructor opens a course's Q&A in the instructor portal and sees the questions nobody authoritative has answered yet, oldest waiting first, each with its lesson, author, age and reply count. They open one, reply or accept an answer, and it leaves the list.

**Why this priority**: Required by the issue, and it is what makes the feature useful to the instructor instead of a source of silent unanswered questions.

**Independent Test**: With three questions (one answered by an instructor reply, one with an accepted answer, one with only a classmate's reply), check only the third is listed; reply as the instructor and check it leaves the list.

**Acceptance Scenarios**:

1. **Given** an instructor of a course, **When** they open its Q&A, **Then** they see its unanswered questions oldest first with lesson title, author, time and reply count, with paging.
2. **Given** a question gets a visible instructor reply or an accepted answer, **When** the list is next loaded, **Then** it is no longer listed.
3. **Given** a question is hidden or deleted, **Then** it is not listed.
4. **Given** a lesson that is archived, **When** the instructor reads the Q&A, **Then** its questions are still listed and readable, but cannot be answered (read-only) until the lesson is restored.
5. **Given** a user who is not an instructor of the course (a student, another course's instructor, an admin not listed on it), **When** they request the list, **Then** it is refused.
6. **Given** an instructor of one course, **When** they name another course's question, **Then** nothing is found.
7. **Given** the list is empty, **Then** a short "all answered" state appears, not an error.

---

### User Story 5 - Report, hide and delete (Priority: P2)

A reader reports a post that is abusive or wrong. Instructors see reported posts in a moderation list, and can hide a post (reversibly), delete it, or dismiss the reports. Authors can delete their own posts.

**Why this priority**: Required by the issue; a discussion without moderation is not safe to open, but the rest works without it.

**Independent Test**: Report a reply as two students, check the instructor sees it flagged with two reporters, hide it and check students see the placeholder while the instructor still reads it, then unhide; delete it and check the text is gone for everyone.

**Acceptance Scenarios**:

1. **Given** a visible post by someone else, **When** a reader reports it, **Then** it is flagged for instructors; reporting again changes nothing; the author cannot report their own post.
2. **Given** reports, **When** an instructor opens the moderation list, **Then** they see reported posts with text, author, lesson and reporter count, with paging.
3. **Given** a reported post, **When** an instructor dismisses the reports, **Then** the flag clears and the post stays as is.
4. **Given** a post, **When** an instructor hides it, **Then** students see "This post was hidden by an instructor" in its place, replies and upvotes on it are refused, and the instructor still reads it; unhiding restores it exactly.
5. **Given** a hidden question, **Then** students see only its placeholder in the lesson list and cannot open it; an instructor opens it in full.
6. **Given** an author or an instructor of the course, **When** they delete a post, **Then** its text is permanently removed and everyone sees "This post was deleted"; the author cannot delete another's post.
7. **Given** a hidden or deleted reply, **Then** the question's visible reply count drops by one and, if it was the accepted answer or the only instructor reply, the question's answered state is recomputed.
8. **Given** a user who is not an instructor, **When** they try to hide, unhide, dismiss or list reported posts, **Then** it is refused.
9. **Given** a student who dropped the course, **When** they try to delete their old post, **Then** it is refused (no access).

---

### User Story 6 - Be told about replies and answers (Priority: P2)

A student who asked a question hears about replies and accepted answers through the notification pipeline: a bell notification (and email where their settings allow) linking to the thread's lesson. The reply's author hears when their reply is accepted.

**Why this priority**: Required by the issue ("hooks into notifications"), but depends on another in-flight feature and is not needed for discussions to be useful.

**Independent Test**: With the pipeline merged, reply to a student's question as another user and check the student has one `discussion.reply` notification linking to the lesson; accept the reply as an instructor and check the replier has `discussion.accepted` and the asker `discussion.answered`; reply to one's own question and check nothing is sent.

**Acceptance Scenarios**:

1. **Given** someone other than the asker replies, **When** the reply is saved, **Then** the asker gets exactly one `discussion.reply` notification, in the same transaction as the reply, with the replier's name, an excerpt and a link to the lesson.
2. **Given** the asker replies to their own question, **Then** no notification is created.
3. **Given** a reply is accepted by someone other than its author, **Then** its author gets one `discussion.accepted` notification; and if the acceptor is not the asker, the asker gets one `discussion.answered`.
4. **Given** the same reply is accepted, unaccepted and accepted again, **Then** no second notification is created for it.
5. **Given** a retried reply, **Then** the asker has one notification.
6. **Given** the notification's link, **When** the asker opens it, **Then** the lesson page opens with its Questions section; nothing in the notification is private beyond a name and an excerpt the asker can read in the thread.
7. **Given** the pipeline is not yet merged, **Then** posting and everything else work with no notification created.

---

### Edge Cases

- A student drops the course after posting: their posts stay; they can no longer read or post, and their notifications' links are refused like any course content.
- An instructor is removed from the course: their earlier replies keep the badge they had when posted.
- A reply races a hide of its question: the transaction checks the question is still shown; the reply is refused, never attached to a hidden question.
- Two instructors hide and delete the same post at once: one transition wins, the other is told the post changed; counts stay right.
- A lesson is archived after threads exist: reads by instructors work, writes are refused, students cannot reach it; restoring it restores everything.
- A lesson with posts is never deleted outright: a permanent delete (and a module delete that would remove it) is refused like one of a lesson students used, so it can only be archived (FR-017). A draft course has no students and so no posts.
- A title or body with accents, emoji or right-to-left text: stored and shown as typed; line breaks are kept; nothing is interpreted.
- Very long single words: wrapped by the display, never overflowing.
- Thousands of questions in a course: every list is keyed and paged, never scanned.
- A reporter list over 20: extra reports succeed without being stored.
- The notification pipeline is delayed or absent: posting never fails because delivery is behind.

## Requirements *(mandatory)*

### Functional Requirements

**Access**

- **FR-001**: Only a student whose enrolment in the course is not `dropped`, or an instructor listed on the course, MUST be able to list questions, open a thread, post, reply, vote, report or accept. No call takes a caller-supplied user id. Refusals MUST match the rest of the course's content (not found when the course is not visible to the caller, forbidden for a published course they are not enrolled in).
- **FR-002**: Writes by students and instructors alike (question, reply, vote, accept, report) MUST be refused unless, in the same transaction as the write, the course is published and the lesson and its module are shown (visible and not archived). Hide, unhide, delete and dismiss (instructor moderation, and authors deleting their own posts) remain allowed in an archived course and in archived or hidden lessons (only the caller's access to the course is checked). Reads follow what the caller can see of the course: students read the threads of lessons they can open, including in an archived course; instructors read any lesson's threads, including archived or hidden lessons.

**Questions and replies**

- **FR-003**: A question MUST have a title of 1 to 120 characters and a body of 1 to 4,000, after trimming, as plain text; a reply MUST have a body of 1 to 4,000. Invalid input MUST be refused before anything is written. Markup MUST be shown as text everywhere.
- **FR-004**: Each post MUST record its author, the author's display name (the shared learner-name rule, never the email) and whether the author was a course instructor, when posted. These MUST NOT change when the user or the course later changes.
- **FR-005**: Posting MUST be idempotent against client retry: the client supplies the post's id, the server accepts it only within 10 minutes of its own clock and creates the post only if the id is new.
- **FR-006**: A question MUST take at most 500 visible replies; posting another, or unhiding one past the limit, is refused with a clear message.
- **FR-007**: A lesson's questions MUST be listed newest first with paging that is stable under new posts and deletions; a thread's replies MUST be listed oldest first with the same paging, the accepted answer first. Upvotes MUST NOT change the order.
- **FR-008**: Posting a question or reply MUST NOT count as student activity: it MUST NOT change `studentActivityCount`, completion, progress or `lastActivityAt`.

**Votes and answers**

- **FR-009**: A reader MUST be able to upvote any visible post but their own, once, and remove it; counts MUST equal the number of upvotes however many arrive concurrently.
- **FR-010**: The question's author or an instructor of the course MUST be able to accept one visible reply of that question as its answer, replace it with another, or remove it. A question has at most one accepted answer.
- **FR-011**: A question is *answered* when it has an accepted answer or a visible reply by an instructor of the course; otherwise *unanswered*. Hiding, deleting or restoring posts MUST recompute this.

**Instructor views and moderation**

- **FR-012**: Instructors of a course MUST be able to list its unanswered questions, oldest first, with paging, including those of archived or hidden lessons and for an archived course, and to open any thread, including hidden posts, and to list all questions of any one lesson. Hidden and deleted questions are not in the unanswered list.
- **FR-013**: A reader MUST be able to report a visible post that is not their own, once; the post is flagged with a reporter count (up to 20 reporters remembered). Instructors MUST be able to list flagged posts of a course, hide or unhide a post, delete any post, and dismiss a post's reports. A report alone MUST NOT change what students see.
- **FR-014**: An author MUST be able to delete their own post while they can access the course. Deleting removes the text permanently, leaves a placeholder, and is final. Hidden posts show a different placeholder to students and the full text to instructors. A hidden or deleted post shows students its placeholder only, with no author name, time or counts. A hidden or deleted question is not openable by students and its replies are not shown to them.
- **FR-015**: Reply counts, upvote counts, the answered state and the reported flag MUST stay equal to what the records say after any combination of concurrent writes, hides, deletes and acceptances.
- **FR-016**: Instructor-only actions MUST be unavailable to everyone else, including an instructor of a different course, and MUST NOT leak whether another course's posts exist.

**Archiving and deletion of lessons**

- **FR-017**: A lesson's threads MUST be kept whole when the lesson or its module is archived or hidden, and MUST reappear unchanged when it is restored. A lesson that has any post MUST NOT be deletable (it can still be archived), by the same rule that stops deleting an item students used.

**Notifications**

- **FR-018**: A new reply MUST notify the question's author (type `discussion.reply`) unless the replier is the author; accepting a reply MUST notify its author (`discussion.accepted`) unless they accepted it themselves, and the asker (`discussion.answered`) unless the asker accepted it; the same acceptance MUST NOT notify twice. The notification joins the post's transaction through the producer helper, so the post and its notification succeed or fail together, and no notification is created for hidden or deleted posts. Without the pipeline merged, nothing is created and nothing fails.

**Quality, safety and local development**

- **FR-019**: Every write to discussion records, and the rules above that span records, MUST go through one shared `core-table` helper that every procedure calls, covered by invariant checks that a test can break (see plan and data model).
- **FR-020**: The feature MUST work end to end in local development without an AWS account and add no AWS service.
- **FR-021**: Both portals MUST use text-only buttons (no arrow icons), render all post text as text, and show loading, empty, error and retry states; a failed section MUST NOT break the rest of the lesson page or course page.
- **FR-022**: The feature MUST NOT add edit, rich text, attachments, mentions, thread subscriptions, search, per-student blocking, an admin portal view or email digests (see Assumptions).

### Key Entities

- **Question**: A student's or instructor's question on one lesson, with a title and body, the author, name and badge as posted, a state (shown, hidden or deleted), counts of visible replies, instructor replies and upvotes, the accepted answer (if any), reporters (if flagged), and whether it is unanswered. Newest first within its lesson.
- **Reply**: An answer or comment within one question, with a body, the author, name and badge as posted, a state, an upvote count and reporters. Oldest first within its question.
- **Upvote**: One person's upvote on one post. At most one per person and post; never by the author.
- **Course instructor**, **Enrolment**, **Lesson/Module**, **User**: existing; say who may use it, where, and supply the author's name.
- **Notification**: Defined by the notifications spec; created through its helper.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A student can ask a question from a lesson in under a minute, and sees it listed immediately.
- **SC-002**: 0 cases where a student who is not enrolled (or dropped), an anonymous caller, or a user outside the course reads or posts; 0 cases where a non-instructor uses an instructor-only action or an instructor reaches another course's posts. Each is covered by a test.
- **SC-003**: After any mix of concurrent replies, votes, hides, deletes and acceptances, 100% of the counts, answered states and flags match the records, and the data-consistency check passes after every test.
- **SC-004**: An instructor sees every unanswered question of a course in one list, and a question leaves it within one page load of being answered.
- **SC-005**: 100% of posts hidden or deleted show no text to students; 100% of threads of an archived lesson are intact after it is restored.
- **SC-006**: With the notification pipeline running, the asker is notified of a reply within the pipeline's normal delay, exactly once, never for their own reply.

## Assumptions

- The Questions section is on the lesson page of the student portal (each lesson page already renders one lesson's items); the instructor's Q&A is a section of the course page in the instructor portal. Both are specified in the plan's contracts.
- Reading and posting calls live in core-api (any authenticated user; the call checks "enrolled or instructor of this course"), so instructors reply with the same calls students use. Instructor-only calls live in instructor-api. Both go through one helper in `core-table`.
- Discava has not launched: no old data or URLs to preserve; new attributes are added outright and no fallback is written for missing ones.
- No new AWS service, index or table: the records join the single table, and the two staff lists use sparse entries of existing indexes.
- Notifications are a producer of the pipeline of the notifications spec; until it merges, the hooks are the last phase and are skipped without error.
- A report carries no reason text. Instructors see the number of reporters, never who they are; reporter ids are kept only to stop one person counting twice.
- Out of scope: editing posts, rich text, attachments, mentions, thread subscriptions or "follow", search across discussions, per-student blocking or rate limits beyond the 500-reply cap and the WAF, an admin portal view, email digests, timestamped questions on videos, counting discussions on the instructor dashboard.
- Only the final implementation PR may close #280.
