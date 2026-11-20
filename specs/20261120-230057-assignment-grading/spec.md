# Feature Specification: Grading and Feedback for Upload Assignments

**Feature Branch**: `20261120-230057-assignment-grading` (spec only; implementation PRs branch from `main`)

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "Assignment grading and feedback for graded upload assignments (issue #102 part 3). Instructors list every enrolled student's submission status for an upload assignment (not submitted, submitted, late, returned, resubmission requested), sorted oldest-waiting first with how long each has waited; open a submission with a signed URL for the file; return it as final with points (0 to maxPoints) and feedback (Tiptap JSON), which locks it; or return it requesting a resubmission with feedback only (no points), using a new status `resubmission_requested` that reopens upload, and the next upload moves it back to submitted. Earlier feedback is kept as history across resubmissions so the student sees what was asked. Returning emits the existing `assignment.returned` notification (in-app and email) linking to the feedback; a resubmission request notifies the student too; instructors are notified of new submissions. Student portal shows points and feedback once returned, and the feedback and resubmit form when a resubmission is requested. Lower priority story, separate PR: a grading queue on the instructor home page listing work waiting across all the instructor's courses, oldest first, which needs a new access pattern (submissions by course and status) designed alongside the grading fields. Only the course's instructors can list, read or return submissions. Out of scope: AI-drafted feedback (#289), completion criteria using the returned score (#594)."

**Parent issue**: #102 (part 3)

## Background

Students can submit one file to an upload assignment and replace it until it is returned (the assignment-submissions feature, now archived at `specs/_archive/20261114-120542-assignment-submissions/`). Nothing yet lets an instructor see that work or answer it: no submission is ever returned, the `assignment.returned` notification is registered but never sent, and the "returned locks resubmission" rule is never triggered. A student who submits never hears back.

Feedback is the learner-priority rank 1 of 10 in the learner feature research, and speed of feedback matters as much as its quality, so this feature covers both answering the work and making waiting work visible to instructors.

## Clarifications

### Session 2026-11-20

- Q: After an instructor returns a submission as final, can they later change its points or feedback? → A: Yes. They can amend points and feedback; the previous values stay in the feedback history and the student is notified that the grade was updated.
- Q: What can instructors do with a submission from a student who has since left the course (for example after a refund)? → A: It is listed, marked as no longer enrolled, and instructors can read and download it but not return, send back or amend it. It doesn't count as waiting and isn't in the grading queue. If the student enrols again, it is treated like any other submission in its state.
- Q: How are instructors told about new submissions? → A: At most one "new submissions" notification per assignment per day (UTC) per instructor, in the app with email off by default, linking to that assignment's submissions. Later submissions that day don't notify again.
- Q: Can instructors view the student's file inside the review page, or only download it? → A: PDFs and images (png, jpg, jpeg, gif, webp) are shown in the page beside the grading form; every other allowed type is download only.
- Q: Can an instructor save a grade and feedback as a draft before the student sees it? → A: Not on the server. The review page keeps unsent points and feedback in the instructor's own browser, per submission, so a reload or accidental close doesn't lose them; they are cleared once sent. Nothing is visible to the student or other instructors until it is sent.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Return a submission with a grade and feedback (Priority: P1)

An instructor opens an upload assignment in a course they teach and sees every enrolled student with the state of their work. They open a submitted piece of work, download the student's file, enter points out of the assignment's maximum and written feedback, and return it. The submission is then final: the student can no longer replace it.

**Why this priority**: This is the missing half of the loop. Without it, submissions go nowhere and students never learn how they did.

**Independent Test**: With a student who has submitted, sign in as the course's instructor, open the assignment's submissions, download the file, return it with points and feedback, and check that the submission is returned, carries the points and feedback, and that the student can no longer resubmit.

**Acceptance Scenarios**:

1. **Given** an upload assignment in a course the instructor teaches, **When** they open its submissions, **Then** they see every enrolled student with their state: not submitted, waiting for grading (with late shown where it applies), resubmission requested, or returned.
2. **Given** that list, **When** the instructor opens a student's submission, **Then** they see the file's name, size and type, when it was submitted, whether it was late, its version, any earlier feedback, and can download the file. A PDF or image is also shown in the page beside the grading form.
3. **Given** an open submission waiting for grading, **When** the instructor enters points between 0 and the assignment's maximum and feedback, and returns it as final, **Then** the submission becomes returned with those points and that feedback, records who returned it and when, and the student can no longer resubmit.
4. **Given** the return form, **When** the points are missing, negative, above the maximum or not a number the assignment allows, **Then** returning is refused with a clear message and nothing changes.
5. **Given** a student with no submission, **When** the instructor views them in the list, **Then** they are shown as not submitted and there is nothing to open or return.
6. **Given** a returned submission, **When** an instructor of the course amends its points or feedback, **Then** the new values replace the current grade, the previous values stay in the feedback history, the submission stays returned and locked, and the student is notified that the grade was updated.

---

### User Story 2 - Student sees the grade and feedback (Priority: P1)

The student is told their work was returned, in the app and by email. Following the link takes them to the assignment, where they see their points out of the maximum, the instructor's feedback, and their submitted file, and no longer see a resubmit form.

**Why this priority**: The grade only helps if the student sees it promptly. Returning without telling the student delivers none of the value.

**Independent Test**: Return a submission as an instructor, then sign in as the student and check that a notification arrived (and an email, when their settings allow), that its link opens the assignment, and that the assignment shows the points, feedback and file without a resubmit form.

**Acceptance Scenarios**:

1. **Given** a submission is returned as final, **When** the return succeeds, **Then** the student receives an "assignment returned" notification in the app and, if their notification settings allow, by email, linking to the assignment.
2. **Given** a returned submission, **When** the student opens the assignment, **Then** they see their points out of the maximum, the feedback, when it was returned, and their file, and no submit form.
3. **Given** a returned submission, **When** the student tries to submit again by any means, **Then** it is refused with a clear message (as today).
4. **Given** the same return processed twice (for example a retried request), **When** both complete, **Then** the student is notified once.

---

### User Story 3 - Ask for a resubmission with feedback (Priority: P2)

Instead of grading, an instructor can send the work back with feedback and ask the student to submit again: a draft, or work that isn't ready to be graded. The student is notified, sees the feedback beside the resubmit form, uploads a new file, and the work goes back to waiting for grading. The feedback from each round is kept, so both the student and the instructor can see what was asked before.

**Why this priority**: "Revise and resubmit" is a common teaching loop and was asked for in the issue's 2026-11-19 update, but returning as final (Stories 1 and 2) delivers the core value without it.

**Independent Test**: Request a resubmission with feedback, check the student is notified and sees the feedback and the resubmit form, resubmit a new file, and check the submission is waiting for grading again with the earlier feedback still visible to both sides; then return it as final.

**Acceptance Scenarios**:

1. **Given** a submission waiting for grading, **When** the instructor requests a resubmission with feedback, **Then** its state becomes resubmission requested, no points are given, and the student is notified in the app and, if their settings allow, by email.
2. **Given** a resubmission request without feedback, **When** the instructor sends it, **Then** it is refused: the student needs to know what to change.
3. **Given** a resubmission request, **When** the student opens the assignment, **Then** they see the feedback, their current file and the resubmit form.
4. **Given** a resubmission request, **When** the student uploads a new file, **Then** the submission goes back to waiting for grading, its version goes up by one, and the late flag is worked out afresh as for any resubmission.
5. **Given** a submission that has had one or more resubmission requests, **When** the instructor or the student views it, **Then** every earlier round's feedback is shown, newest first, with when it was given and which version it was about.
6. **Given** a resubmission request, **When** the student has not yet resubmitted, **Then** the instructor can still return the current version as final with points, which ends the request.

---

### User Story 4 - See which work has waited longest (Priority: P2)

On an assignment's submissions, work waiting for grading comes first, oldest first, each with how long it has waited. Instructors are told when new work arrives, at most once per assignment per day, so they don't have to check and aren't flooded near a due date.

**Why this priority**: Turnaround drives completion, and instructors can only keep it short if they can see what's waiting and for how long. The list itself (Story 1) already works without the ordering and notifications.

**Independent Test**: Have three students submit at different times, open the submissions, and check the waiting ones are listed first, oldest first, each with its waiting time; check each of the course's instructors received one "new submissions" notification for the assignment that day, not three.

**Acceptance Scenarios**:

1. **Given** several submissions waiting for grading, **When** the instructor opens the assignment's submissions, **Then** the waiting ones come first, ordered by how long they have waited (longest first), then those with a resubmission requested, then returned, then not submitted.
2. **Given** a waiting submission, **When** it is listed, **Then** it shows how long it has waited since it was last submitted, in plain terms ("3 days", "5 hours").
3. **Given** a student submits or resubmits to an assignment, **When** it is the first submission to that assignment that day (UTC), **Then** each instructor of the course receives a "new submissions" notification in the app, linking to the assignment's submissions; email for it is off unless the instructor turns it on.
4. **Given** an instructor was already notified about an assignment today, **When** more students submit or resubmit to it that day, **Then** they are not notified again until the next day's first submission.

---

### User Story 5 - A grading queue on the instructor home page (Priority: P3)

The instructor home page shows the work waiting for grading across every course the instructor teaches, oldest first, with the student, assignment, course and waiting time, and a count of how many are waiting. Opening an entry goes straight to that submission.

**Why this priority**: It saves opening every assignment to find waiting work, and brings back the home-page queue removed in #344 now that real data exists. It ships after Stories 1 to 4, in its own pull request, but its lookups are designed with the grading data so the data doesn't need reshaping later.

**Independent Test**: As an instructor of two courses with waiting submissions in both, open the home page and check every waiting submission from both courses is listed oldest first with the right count; return one and check it leaves the queue.

**Acceptance Scenarios**:

1. **Given** an instructor teaching several courses with waiting work, **When** they open the home page, **Then** they see the waiting submissions across all those courses, oldest first, each with the student's name, assignment, course and waiting time, and the total waiting.
2. **Given** that queue, **When** they open an entry, **Then** they land on that submission's review page.
3. **Given** a submission is returned or sent back for resubmission, **When** the queue is next shown, **Then** it is no longer listed; when the student resubmits, it is listed again.
4. **Given** an instructor with no waiting work, **When** they open the home page, **Then** the queue says nothing is waiting, rather than being hidden or showing sample data.

---

### Edge Cases

- The caller isn't an instructor of the course (another instructor, a student, or someone removed from the course): listing, reading, downloading and returning are all refused, and nothing about the submissions is revealed.
- Two instructors of the course return or send back the same submission at the same moment: exactly one succeeds and the other is told the submission has changed and shown its current state.
- The student resubmits while an instructor is grading the previous version: the return is refused because a newer version arrived, and the instructor sees the new file. A grade never lands on a version the instructor didn't see.
- An instructor tries to return a submission that is already returned, or send back one that is already waiting on a resubmission: refused, with the current state shown. (Amending a returned grade is a separate action, FR-011.) A returned submission can't be sent back for resubmission.
- Two instructors amend the same returned grade at the same moment, or one amends while another's earlier amendment lands: exactly one succeeds and the other is told the grade has changed and shown the current one.
- The assignment's maximum points is changed after some submissions were returned: returned points stay as given, shown out of the maximum they were graded against.
- The assignment, its lesson or module is hidden or archived, or the course is archived, after work was submitted: instructors can still list, read and return submissions, and the student is still notified; the student sees the feedback only while the assignment is shown, as with their submission today.
- A student is no longer enrolled (for example after a refund) but has a submission: it still appears in the list, marked as no longer enrolled, so the work isn't lost. Instructors can read and download it but can't return, send back or amend it, and it isn't counted as waiting or shown in the grading queue. If the student enrols again, it is waiting (or in whatever state it was) as before.
- A student leaves the course while their submission is waiting: it leaves the waiting work and the grading queue at the same time as the enrolment ends.
- The due date passes for a student who never submitted: they are listed as not submitted; there is no automatic zero.
- The feedback contains formatting, mathematics or links: it is shown to the student exactly as the instructor wrote it, using the same rich-text rules as the rest of the course content.
- Feedback is very long: it is limited to a reasonable size, and longer feedback is refused with a clear message, not cut off.
- An assignment with many students: the list loads in pages and stays in the same order across pages.
- A notification can't be delivered (for example the student's email bounces): the return still succeeds; delivery follows the notification pipeline's own rules.
- A quiz assignment: graded automatically as today and not part of this feature; its submissions page doesn't exist.

## Requirements *(mandatory)*

### Functional Requirements

**Listing and reading (instructors)**

- **FR-001**: An instructor of a course MUST be able to list, for one upload assignment, every student enrolled in the course with their state: not submitted, waiting for grading, resubmission requested or returned, and for those with a submission, whether it is late, when it was last submitted and its version. Students no longer enrolled who have a submission MUST also be listed, marked as no longer enrolled, and are read-only: their submission can be read and downloaded but not returned, sent back or amended, and it MUST NOT count as waiting (in the list's ordering, the waiting count or the grading queue) while they are not enrolled.
- **FR-002**: The list MUST order waiting submissions first by time waited (longest first), then resubmission requested, then returned, then not submitted, and MUST show each waiting submission's time waited since its last submission. It MUST load in pages with a stable order.
- **FR-003**: An instructor of the course MUST be able to open one student's submission and see the file's name, size and type, submitted time, late flag, version, state, the current grade and feedback if returned, and the history of earlier feedback; and MUST be able to download the file through a short-lived link. When the file is a PDF or an image (png, jpg, jpeg, gif, webp), it MUST also be shown in the page beside the grading form, through a short-lived link that displays it rather than downloading it; no other type is ever displayed in the page.
- **FR-004**: Only instructors of the course MUST be able to list, read, download, return, send back or amend its submissions. Students MUST still be able to read only their own submission and feedback.

**Returning (instructors)**

- **FR-005**: An instructor MUST be able to return a submission that is waiting for grading or has a resubmission requested as **final**, with points (a number from 0 to the assignment's maximum, inclusive) and feedback (rich text, optional). Returning records the points, the maximum they are out of, the feedback, who returned it and when.
- **FR-006**: A submission returned as final MUST be locked against resubmission (the existing rule).
- **FR-007**: An instructor MUST be able to **request a resubmission** of a submission that is waiting for grading, with feedback (required, non-empty) and no points. This puts it in a new state, resubmission requested, which lets the student submit again.
- **FR-008**: A return or a resubmission request MUST apply only to the version the instructor viewed; if the student has submitted a newer version, or the submission has otherwise changed since, it MUST be refused and the current state shown.
- **FR-009**: Each round of feedback (a resubmission request, the final return, and any later amendment) MUST be kept, with when it was given, who gave it, and the version it was about, so earlier rounds stay visible after a resubmission or an amendment.
- **FR-010**: The review page MUST keep unsent points and feedback in the instructor's own browser, per submission, so reloading or closing the page doesn't lose them, and MUST clear them once they are sent. If the browser can't store them, the page still works without it. Nothing unsent is stored on the server or shown to anyone else.
- **FR-011**: An instructor of the course MUST be able to amend the points and feedback of a returned submission, under the same rules as returning (FR-005, FR-012). The amendment replaces the current grade, keeps the previous values in the feedback history (FR-009), leaves the submission returned and locked, and applies only if the grade hasn't changed since the instructor viewed it.
- **FR-012**: Feedback MUST use the same rich-text format and rules as other course text (including mathematics), MUST be validated as such, and MUST be limited in size.
- **FR-013**: Returning MUST NOT change the student's completion of the assignment or the course's activity counts: the assignment was already complete when the student submitted (decision 2 of #102), and a resubmission request doesn't undo it.

**Students**

- **FR-014**: A student whose submission has a resubmission requested MUST be able to resubmit, following all the existing submission rules (one file, allowed types, size limit, version increment, late flag worked out afresh, delayed retirement of the replaced file). The resubmission MUST put the submission back to waiting for grading.
- **FR-015**: A student MUST see, on the assignment, their points out of the maximum and the feedback once returned, and the feedback beside the resubmit form when a resubmission is requested, plus earlier rounds of feedback, under the same visibility rules as their submission today (only while the assignment is shown with no hidden or archived ancestor).

**Notifications**

- **FR-016**: Returning as final MUST notify the student with the existing "assignment returned" type, in the app and by email per their settings, linking to the assignment.
- **FR-017**: A resubmission request MUST notify the student with its own "resubmission requested" type, distinct from "assignment returned" so the student can tell them apart, in the app and by email per their settings (email on by default), linking to the assignment.
- **FR-018**: Amending a returned grade MUST notify the student with its own "grade updated" type, in the app and by email per their settings (email on by default), linking to the assignment.
- **FR-019**: Submissions and resubmissions MUST notify each instructor of the course with a "new submissions" type, at most once per assignment per day (UTC) per instructor, in the app with email off by default, linking to the assignment's submissions list.
- **FR-020**: Every notification in this feature MUST be sent in the same atomic change as the action that causes it, and MUST be sent once even if that action is retried.

**Grading queue (Story 5)**

- **FR-021**: The instructor home page MUST show the submissions waiting for grading across all courses the instructor teaches, oldest first, with the student, assignment, course and time waited, the total waiting, and a link to each submission. It MUST be served by a direct lookup, not by reading every assignment in every course.
- **FR-022**: The data needed for FR-021 MUST be designed with this feature's grading data (Stories 1 to 4), even though the queue itself ships later, so that the grading data does not need reshaping when it does.

**Consistency and platform**

- **FR-023**: The rules that span records or writers (a returned submission carries points within the maximum it was graded against and a returner; a resubmission request carries feedback; the waiting-work lookup agrees with each submission's state and the student's enrolment) MUST be written through shared helpers and covered by data-consistency checks, each with a test that breaks it.
- **FR-024**: The feature MUST work end to end in local development without an AWS account, including notifications and file downloads.
- **FR-025**: The main flow (student submits, instructor returns with feedback, student sees it) MUST be covered by an end-to-end scenario.

**Out of scope**

- **FR-026**: Out of scope: AI-drafted feedback (#289); completion criteria or certificates that use the returned score (#594); grading quiz assignments, which stay automatic; rubrics; annotating the student's file; feedback files attached by the instructor; draft grades saved on the server or shared between instructors (FR-010 keeps an unsent form in the instructor's own browser only); anonymous grading; exporting grades.

### Key Entities

- **Assignment submission** (existing): a student's current work for one upload assignment. Gains the state resubmission requested (alongside submitted and returned), the final grade (points, the maximum they are out of, feedback, returned by, returned at), and the feedback history.
- **Feedback round**: one instructor response to one version of a submission: the kind (resubmission requested, final return, or amendment of a returned grade), the feedback, points for a final return or amendment, who gave it, when, and which version it was about. A submission has zero or more, kept in order.
- **Waiting work entry**: what the instructor grading queue and the per-assignment ordering read: a submission waiting for grading, findable by course and by how long it has waited, so the queue across an instructor's courses is a direct lookup.
- **Upload assignment item** (existing): supplies the maximum points and the title shown in notifications.
- **Notification types**: "assignment returned" (existing), plus new "resubmission requested" and "grade updated" (to the student) and "new submissions" (to the course's instructors, at most once per assignment per day).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An instructor can go from opening an assignment's submissions to returning one piece of work with points and a short paragraph of feedback in under 2 minutes, not counting time spent reading the work.
- **SC-002**: 100% of returns and resubmission requests by anyone who isn't an instructor of the course are refused, and 0 cases where they can see another course's submissions.
- **SC-003**: 100% of returned submissions reach the student as an in-app notification within a minute of returning, and 0 duplicate notifications for one return.
- **SC-004**: 0 grades recorded against a version the instructor didn't see: when a student resubmits during grading, the return is refused in 100% of runs.
- **SC-005**: When two instructors return the same submission at the same moment, exactly one succeeds in 100% of runs.
- **SC-006**: 100% of points recorded are between 0 and the maximum they were graded against, and the data-consistency check passes after every test.
- **SC-007**: After a resubmission request and a resubmission, 100% of earlier feedback rounds are still visible to the student and the instructor.
- **SC-008**: An instructor can find their longest-waiting piece of work across all their courses from the home page in one click, and the queue's count matches the number of submissions waiting.

## Assumptions

- The assignment-submissions feature has shipped: submissions, files, resubmission, the returned state and the lock it implies, the student's view of their submission, and the 5-minute download links. This feature builds on that submission record and does not add a competing one.
- The notification pipeline is in place, including the registered "assignment returned" type and per-user email settings; new types are added to its registry.
- A course can have several instructors; every instructor of the course can grade every submission, and all of them are told about new submissions (as reviews notify every instructor today).
- Feedback with a resubmission request has no points; points are given only on a final return.
- There is no limit on how many times a submission is sent back for resubmission.
- Previewing other document types (for example Office files) inside the page is left for later; it would need a conversion service.
- Returning doesn't affect completion or progress (decision 2 of #102: an upload assignment completes on submit).
- The grading queue (Story 5) ships in its own pull request after Stories 1 to 4.
- Issue #102 closes when this feature's last pull request merges; earlier pull requests must not use a closing keyword for it.
