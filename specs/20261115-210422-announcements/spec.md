# Feature Specification: Instructor Announcements to Enrolled Students

**Feature Branch**: `20261115-210422-announcements`

**Created**: 2026-11-15

**Status**: Draft

**Input**: User description: "Issue #282, feat(announcements): instructor announcements to enrolled students. Instructors create, edit and delete rich-text announcements per course. Shown in the course home for enrolled students; delivered through the notification pipeline. Only course instructors can post; only enrolled students (and instructors) can read."

**Parent issue**: #282

**Depends on**: the notifications spec ([`specs/20261115-204427-notifications/`](../20261115-204427-notifications/spec.md), PR #331, issue #281). See [Dependency on the notifications spec](#dependency-on-the-notifications-spec). Announcements publish through that spec's producer contract and add no delivery of their own.

## Dependency on the notifications spec

This feature is a producer of the notification pipeline. It uses, unchanged, the contract in [`notifications/contracts/producer-helpers.md`](../20261115-204427-notifications/contracts/producer-helpers.md): the registered type `announcement.posted` and `notifyCourseStudents`. It does not write notification records, read the enrolment list for delivery, send email or check preferences.

What must be merged first, by the notifications spec's own task list (`specs/20261115-204427-notifications/tasks.md`):

| Needed for | Notifications tasks | Phase |
|------------|---------------------|-------|
| Posting at all (the registry entry `announcement.posted`, `notifyCourseStudents`, the `notificationBroadcast` entity, the stream filters, the invariants that a broadcast must satisfy) | T001 to T003, T004, T007 | 1 and 2 |
| Students actually receiving the notification (fan-out from the table stream, the local event runner, the `notify-local` script) | T014, T016, T017 | 5 |
| Students seeing it in the bell | T008 to T010 (the API), T028 to T030 (the bell) | 3 and 8 |
| Students getting the email (not needed to ship announcements; it follows whenever those phases land) | T011 to T013, T015, T018 to T027 | 4, 6 and 7 |

So this feature's backend can be built once notifications Phases 1 and 2 are merged, its end-to-end scenario needs Phase 5 as well, and the bell and email follow when their phases land with no change here. This feature's own task list marks the same gate in its first phase.

## Clarifications

### Session 2026-11-15

- Q: Does creating an announcement always notify students, or can the instructor choose? → A: Always. Posting notifies every student enrolled at that moment, in the bell and by email as each student's settings allow. There is no "post without notifying" switch in v1. The course home list is the quiet record.
- Q: Does editing re-notify? → A: No. An edit changes what students see in the course home and never creates a notification. The notification already sent keeps the title and excerpt it was created with (notifications are immutable), and its link opens the course home, which always shows the current text.
- Q: What does deleting do to notifications already sent? → A: They stay (notifications are never deleted by this feature), and the link still opens the course home, where the announcement is simply gone. Nothing in a notification is private beyond the title and an excerpt the student was already shown.
- Q: Who counts as "enrolled" for reading? → A: Whoever the course page already treats as enrolled: an enrolment that is not `dropped`. A student who drops loses access to announcements as to the rest of the course; one who re-enrols sees all of them again, including those posted before they first enrolled. Late joiners are not notified retroactively (the audience is fixed when the broadcast is processed).
- Q: Can an instructor write for a course another instructor teaches? → A: Any instructor listed on the course can create, edit and delete any announcement of that course, not only their own. The author shown is whoever created it.
- Q: Which formatting does "rich text" mean? → A: The same as lesson text and quiz questions: the shared editor's formatting, lists and formulas, stored and shown through the shared content extensions. No images, files, embeds or links beyond what that editor already supports.
- Q: How does a retried post become one announcement? → A: The form creates the announcement's id when it opens: a time part (the moment, in milliseconds) and a random part. The server accepts the id only if its time part is within 10 minutes of the server's clock, uses that time as the creation time, and creates the record only if the id is new, so a retry with the same id changes nothing and a retry's notification request carries the same key and time. A second announcement needs a new form, hence a new id (plan R-3).
- Q: Does a course with no enrolled students still accept posts? → A: Yes. The announcement is saved and a broadcast request is made; the pipeline finds no recipients and completes it. Posting is never blocked by audience size.
- Q: Are draft courses postable? → A: No. A draft course has no students; only `published` accepts new announcements (FR-007). Draft courses' announcements (none can exist) need no special rule.
- Q: Can a student read announcements of a course that was archived after they enrolled? → A: Yes, by the same rule as the rest of the archived course's content (an existing, non-dropped enrolment), via the same requirement helper course content uses.
- Q: Is the announcement shown on the public course page (`/learn/<courseId>`) too? → A: No. Only the enrolled student's course home, because the public page is for people who may not be enrolled.
- Q: Can announcements be pinned, scheduled, or limited to part of the cohort? → A: No. All out of scope for v1 (see Assumptions).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Post an announcement that reaches every student (Priority: P1)

An instructor opens one of their courses, writes an announcement with a title and a formatted body (for example a changed deadline, with a bold date and a short list), and posts it. It appears at the top of the course's announcements for the instructor, and every student enrolled in the course is notified through the notification pipeline: a bell notification (and an email where their settings allow) whose title names the announcement and the course, with a short plain-text excerpt, linking to the course home.

**Why this priority**: Telling students something, and having them notice, is the whole point. Without the post and the notification there is no feature.

**Independent Test**: As an instructor of a course with three enrolled students, post an announcement and check it is listed for the instructor, and that each of the three students (and no one else, including a student of another course, a dropped student, and the instructor) gets exactly one `announcement.posted` notification whose link opens the course home. Post the same request twice by retrying and check there is still one announcement and one notification each.

**Acceptance Scenarios**:

1. **Given** an instructor of a published course, **When** they post an announcement with a title and a non-empty rich-text body, **Then** it is saved and listed first in the course's announcements, with the author and the time.
2. **Given** the announcement was posted, **When** the notification pipeline processes it, **Then** each student enrolled in the course (status not `dropped`) has one notification of type `announcement.posted`, with the course title, the announcement title and a plain-text excerpt of the body, linking to the course home.
3. **Given** the announcement save and its notification request, **When** the save fails or is cancelled for any reason (the course was archived a moment before, the caller lost instructor access), **Then** nothing is saved and nothing is sent. They succeed or fail together.
4. **Given** the instructor's post request is retried after a timeout or a double click, **When** it reaches the server again, **Then** there is still one announcement and each student has one notification.
5. **Given** a user who is not an instructor of the course (a student, another course's instructor, an admin who is not listed on it), **When** they try to post, **Then** the request is refused and nothing is written.
6. **Given** a course that is not published (draft or archived), **When** an instructor tries to post, **Then** it is refused, because there is no audience to tell.
7. **Given** a title that is empty or longer than the limit, or a body that is empty, not valid shared-editor content, or longer than the limit, **When** the instructor posts, **Then** it is refused with a message naming the problem and nothing is saved.
8. **Given** a very long body, **When** the notification is built, **Then** the excerpt is cut to a fixed length with an ellipsis and carries no formatting; the full text is only in the course home.

---

### User Story 2 - Read announcements in the course home (Priority: P1)

An enrolled student opens their course home and sees a section with the course's announcements, newest first, each with its title, author, the time it was posted (and "edited" when it has been), and its formatted body. When there are many, they load more. A student who is not enrolled in the course, or has dropped it, sees none of this and cannot fetch them.

**Why this priority**: The acceptance criteria require the course home as the place announcements live, and it is what a notification links to. The read rule (enrolled students and instructors only) is a security requirement, so it ships with the list.

**Independent Test**: With announcements posted to two courses, sign in as a student enrolled in the first only: the course home lists the first course's announcements newest first and renders formatting and formulas; requesting the second course's announcements directly is refused; a dropped student is refused for the first.

**Acceptance Scenarios**:

1. **Given** an enrolled student and a course with announcements, **When** they open the course home, **Then** the announcements are listed newest first with title, author name, posted time and the formatted body.
2. **Given** an announcement an instructor edited, **When** a student views it, **Then** they see the current text and an "edited" marker with the edit time.
3. **Given** more announcements than one page holds, **When** the student asks for more, **Then** the next page loads without repeating or skipping any, even if a new announcement arrived meanwhile.
4. **Given** a course without announcements, **When** the student opens the course home, **Then** a short empty state appears, not an error.
5. **Given** a student who is not enrolled in the course or who dropped it, **When** they request its announcements, **Then** the request is refused (not found for a course they cannot see at all, forbidden for a published course they could enrol in), the same as the rest of the course's content.
6. **Given** a student followed a notification's link, **When** the course home opens, **Then** the announcement that triggered it is on the page (first page when it is among the newest); the list is never a separate page they need to find.
7. **Given** announcement text with HTML-looking or script-like content, **When** it is shown, **Then** it appears as plain text or is dropped, never executed: only the shared editor's node types render.

---

### User Story 3 - Edit and delete announcements (Priority: P2)

An instructor fixes a typo or changes a date by editing an announcement, or removes one that was wrong. Students see the corrected text, or its absence, the next time they load the course home. An edit does not notify students again.

**Why this priority**: Required by the issue, but a post works without it, and mistakes are the reason it matters.

**Independent Test**: Post, edit the title and body, and check students see the new text with an "edited" marker and no new notification exists. Delete it and check it is gone from every student's list and from the instructor's, while the original notification remains and its link still opens the course home.

**Acceptance Scenarios**:

1. **Given** an instructor of the course, **When** they edit an announcement's title or body, **Then** the change is saved with an edited time and students see it on their next load.
2. **Given** an edit, **When** it is saved, **Then** no notification is created or changed.
3. **Given** an instructor of the course, **When** they delete an announcement after confirming, **Then** it disappears from the instructor's and the students' lists.
4. **Given** two instructors editing the same announcement at once, **When** both save, **Then** one wins and the other is told the announcement changed and shown the newer text, so neither overwrites silently.
5. **Given** an announcement deleted while another instructor has it open for editing, **When** they save, **Then** they are told it no longer exists and nothing is recreated.
6. **Given** a user who is not an instructor of the course, **When** they try to edit or delete, **Then** it is refused and the announcement is unchanged, including when they know its id.
7. **Given** an announcement id from a different course than the one named in the request, **When** it is edited or deleted, **Then** nothing is found, so an instructor of one course can never change another course's announcement.
8. **Given** an archived course, **When** an instructor edits or deletes an announcement, **Then** it is allowed (cleaning up is not blocked by archiving); only posting needs a published course.

---

### User Story 4 - Manage a course's announcements in the instructor portal (Priority: P2)

In the instructor portal, an instructor sees an announcements section for each of their courses: the list newest first, a form to write a new one with the shared rich-text editor, and edit and delete on each. The form says that posting notifies the enrolled students, so no one posts by accident.

**Why this priority**: Stories 1 and 3 are only usable through this screen. It is split out so the backend can land and be tested first.

**Independent Test**: Sign in as an instructor, open a course, write and post an announcement with formatting, edit it, and delete it, seeing each reflected in the list; as another instructor not on the course, check there is no way in.

**Acceptance Scenarios**:

1. **Given** an instructor on their course page, **When** they open announcements, **Then** the list shows each announcement's title, posted and edited time, author and body.
2. **Given** the new announcement form, **When** the instructor submits, **Then** the button is disabled while the request runs and an error leaves what they typed in place.
3. **Given** the form, **When** it is shown, **Then** it states that enrolled students will be notified (no count is promised, since the audience is fixed when the pipeline processes it).
4. **Given** the delete action, **When** chosen, **Then** a confirmation names the announcement and says students keep the notification they already received.
5. **Given** an archived course, **When** the instructor opens announcements, **Then** the list, edit and delete work and the new announcement form is replaced by a note that archived courses cannot post.

---

### Edge Cases

- A student enrols after an announcement was posted: they see it in the course home and are not notified. A student who enrols while the notification pipeline is still processing a broadcast may or may not be notified, per the notifications spec (the audience is those enrolled when processed); either way they can read it.
- The course is archived right after posting but before the pipeline runs: the broadcast still completes. Students still enrolled are notified; the notification pipeline does not recheck the course.
- Two announcements posted at the same instant: both are saved, listed in a stable order, and each notifies once. Their ids differ, so their dedupe keys differ.
- An instructor is removed from the course after opening the form: the post or edit is refused when saved.
- A course is deleted or archived while a student reads the list: the next request is refused as for any course content.
- The instructor posts text that includes a student's name or private data: nothing prevents it, but the notification excerpt is plain text of the body the recipients can already read in the course home, so it discloses nothing beyond that.
- A title with HTML characters shows as text in the bell, the email and the list (the notification pipeline escapes it; the portal renders it as text).
- A body whose stored JSON is not valid shared-editor content (for example, written by a buggy client): the write is refused, and a stored one that fails to render shows a short "could not display" note rather than breaking the list.
- The notification pipeline is not yet deployed or fully built (no fan-out): the announcement is saved and shown; the broadcast request waits in the table and is processed when fan-out runs. Posting never fails because delivery is behind.
- 5,000 enrolled students: posting is one request writing one announcement and one broadcast, as fast as for 5; the fan-out happens afterwards.

## Requirements *(mandatory)*

### Functional Requirements

**Posting and the notification**

- **FR-001**: An instructor listed on a published course MUST be able to create an announcement for it with a title and a rich-text body. Nobody else MUST be able to, including admins not listed on the course.
- **FR-002**: The title MUST be 1 to 120 characters after trimming. The body MUST be valid shared-editor content (the same content extensions lesson text uses) with at least one character of text, within a stored size limit (see Assumptions). Invalid input MUST be refused before anything is written.
- **FR-003**: Creating an announcement MUST, in the same transaction, request an audience notification of the registered type `announcement.posted` for the course through the notification pipeline's course-audience producer helper, so the announcement and its notification request succeed or fail together. The producer MUST NOT write notification records, read the enrolment list for delivery, send email, or apply preferences.
- **FR-004**: The notification request's dedupe key MUST be the announcement's id and its occurred-at time MUST be the announcement's creation time, so retrying the post reproduces the same request and each student ends with one notification.
- **FR-005**: The notification's parameters MUST be the course id and title, the announcement title, and a plain-text excerpt of the body (no formatting, cut to a fixed length with an ellipsis). The link MUST open the student portal's course home.
- **FR-006**: Posting MUST be idempotent against a client retry: a retried request MUST NOT create a second announcement. (The client supplies the announcement's id, see Clarifications; the server validates it.)
- **FR-007**: Posting MUST be refused for a course that is not published, checked in the same transaction as the write, so a course archived concurrently cannot gain an announcement.

**Reading**

- **FR-008**: A student with an enrolment in the course that is not `dropped` MUST be able to list its announcements, newest first with paging, and nobody else MUST be able to through the student-facing API. The refusal MUST match the rest of the course's content (not found when the course is not visible to them, forbidden when it is a published course they are not enrolled in).
- **FR-009**: An instructor listed on the course MUST be able to list its announcements through the instructor-facing API, including when the course is archived. No call takes a caller-supplied user id.
- **FR-010**: Each announcement in a list MUST carry its id, title, rich-text body, author id and display name, creation time, and edit time when edited.
- **FR-011**: The student portal's course home MUST show the course's announcements as specified in User Story 2, with an empty state and load-more paging.
- **FR-012**: Paging MUST be stable under new posts and deletions (a cursor over the sort key, not an offset).

**Editing and deleting**

- **FR-013**: An instructor listed on the course MUST be able to edit an announcement's title and body and to delete it, at any course status. Edits MUST NOT create, change or remove any notification.
- **FR-014**: An edit and a delete MUST be refused for an announcement that does not belong to the course named in the request, and MUST NOT leak whether another course's announcement exists.
- **FR-015**: An edit MUST detect a concurrent change (a version the caller read must still be current) and refuse otherwise with a clear conflict; an edit or delete of an announcement that no longer exists MUST fail with not found and MUST NOT recreate it.
- **FR-016**: An edit MUST set the edit time and increase the announcement's version. The creation time, author and id never change.
- **FR-017**: Deleting is a permanent removal of the announcement. It leaves notifications already created, as the notification pipeline never deletes them.

**Instructor portal**

- **FR-018**: The instructor portal MUST provide, per course, a list, a create form, edit and delete (with confirmation) using the shared rich-text editor, and MUST state in the create form that enrolled students will be notified. For an archived course it MUST show the list, edit and delete and no create form.

**Quality, safety and local development**

- **FR-019**: The rule that every announcement belongs to an existing course, has a valid shape, and (if it was posted) has a matching audience request MUST live in one shared `core-table` helper that creates it, covered by an invariant check with a test that breaks it. No handler writes the announcement record by another route.
- **FR-020**: Body text MUST render only the shared content extensions' node types; markup in a title or in text content MUST be shown as text, never executed.
- **FR-021**: Everything MUST work in local development without an AWS account (the notification stand-ins from the notifications spec cover delivery; this feature adds no AWS service).
- **FR-022**: Announcements MUST NOT change any existing record's meaning: no counter, completion, enrolment or content item is touched. The only shared records written are the announcement itself and the notification pipeline's audience request through its helper.
- **FR-023**: The feature MUST use only what the notifications spec's producer contract exports. Anything it needs beyond that (see the Assumptions' contract notes) is a change to that contract made deliberately with its tests, not a workaround here.

### Key Entities

- **Announcement**: One post for one course. Has the course, a time-sortable id, title, rich-text body, the author (an instructor), created time, edited time (absent until edited), and a version. Ordered newest first within its course.
- **Audience notification request**: Defined by the notifications spec. Created in the same transaction as the announcement, with the announcement's id as its dedupe key. Owned and processed by the pipeline.
- **Course instructor**: Existing; says who may post, edit, delete, and read as staff.
- **Enrolment**: Existing; says which students may read, and is read by the pipeline (not by this feature) to choose recipients.
- **User**: Existing; supplies the author's display name.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An instructor can write, format and post an announcement and see it listed in under a minute, and posting takes one request regardless of how many students are enrolled.
- **SC-002**: 100% of students enrolled when a post is processed get exactly one notification for it, and 0 students get two, including after retries.
- **SC-003**: 0 cases where a non-instructor creates, edits or deletes an announcement, where an instructor changes another course's announcement, or where a student who is not enrolled (or dropped) reads one.
- **SC-004**: 100% of announcements that exist have their audience request, and 0 requests exist for announcements that failed to save, checked by the data-consistency check after every test.
- **SC-005**: A student sees a new announcement in their course home on their next page load, and, with the pipeline running, in the bell within one minute.
- **SC-006**: An edit never produces a notification: 0 notifications created by edits across the test suite.
- **SC-007**: A contributor with Docker and no AWS account can post an announcement and see the student's bell notification and the course home entry locally in under two minutes.

## Assumptions

- **Dependency**: built on the notifications spec's contract as written (`announcement.posted`, `notifyCourseStudents`, `NOTIFICATION_TYPES`). Contract notes: the registry row for `announcement.posted` names the path `/learn/<courseId>`, which in the student portal is the public course page; the course home an enrolled student wants is `/learn/<courseId>/home`. This feature asks for that one-line change to the registry entry and its test (in notifications task T002, before it merges, or as this feature's first task if it already has). No other contract change is needed.
- **Limits**: title 120 characters; body at most 20,000 characters of stored editor JSON (roughly several pages of text); notification excerpt about 200 characters, within the registry's 500-character body limit.
- **Excerpt**: the plain text of the body's first paragraphs, whitespace collapsed, formulas shown as their source, cut at a word boundary. It is built by a small shared helper beside the editor's other content code, not by the pipeline.
- **Notify on create only**, always (see Clarifications). There is no per-post switch, no scheduling, no pinning, no audience narrowing (for example, by group), no read receipts or unread markers in the course home, and no comments or reactions. Each can be added later without changing the record's shape in an incompatible way.
- **Delete is permanent** (no soft delete or restore). The notification and any email already sent are not recalled.
- **Who is "an instructor of the course"**: a `courseInstructor` membership, as for every other instructor-api procedure. Admins can read and write announcements only if they are also listed on the course.
- **Archived courses** keep their announcements readable (by the same rule as the rest of the course's content) and editable or deletable by instructors, but accept no new ones.
- **Notifying instructors** (for example co-instructors) is out of scope; the built-in audience is enrolled students only, per the notifications spec.
- **Display name** of the author is read from the user record when listing, with a neutral fallback when it is missing.
- **No migration**: Discava has not launched, so no old data needs to be converted and the shapes can change outright.
- **Local development** uses the notifications spec's local event runner and inbox. Nothing here needs a new local service.
- **Issue #282** is closed by the PRs implementing this spec once the notifications phases it needs have merged.
