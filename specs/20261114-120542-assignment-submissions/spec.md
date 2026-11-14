# Feature Specification: Student Submissions for Upload Assignments

**Feature Branch**: `20261114-120542-assignment-submissions`

**Created**: 2026-11-14

**Status**: Draft

**Input**: User description: "Student submissions for upload assignments (issue #102, part 2 remainder, following PR #294 which shipped assignment lessons and upload assignment authoring)."

## Clarifications

### Session 2026-11-14

- Q: When a student resubmits, is the late flag recalculated or kept from the first submission? → A: Recalculated on every submission, so it always describes the latest submission.
- Q: Should resubmissions per student per assignment be capped? → A: No cap; the version number records how many there were.
- Q: Must a resubmission re-attach all files? → A: No. The resubmit form starts with the current files; the student can keep, remove or add files, and the resulting 1–5 files become the new version.
- Q: If the assignment or anything above it is later hidden or archived, can the student still view and download their own submission? → A: No, same as other content. The data is kept and becomes available again if the content is shown again.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Submit work to an upload assignment (Priority: P1)

An enrolled student opens an upload assignment in a published course, reads the instructions, attaches up to 5 files, and submits. They see confirmation that their work was received, and the assignment counts as done in their progress.

**Why this priority**: Submitting is the whole point of an upload assignment. Without it, assignments authored in #294 can't be used by students, and part 3 (grading) has nothing to grade.

**Independent Test**: Enroll a student in a published course containing an upload assignment, submit one file, and check that the submission is stored, the assignment shows as complete, and the student's course activity count went up by one.

**Acceptance Scenarios**:

1. **Given** an enrolled student and a shown upload assignment in a published course, **When** they attach 1–5 allowed files and submit, **Then** the submission is saved with its files, the assignment is marked complete, and they see a confirmation.
2. **Given** the same student, **When** they submit before the due date, **Then** the submission is not flagged late.
3. **Given** the same student, **When** they submit after the due date, **Then** the submission is accepted and flagged late, and the student is told it was late.
4. **Given** a student who has never submitted to this assignment, **When** they submit for the first time, **Then** they are counted once as active in the course.
5. **Given** a student attaching files, **When** a file is larger than 100 MB, is not of an allowed type, or they attach a sixth file, **Then** they are told why and nothing is submitted.

---

### User Story 2 - Resubmit until the work is returned (Priority: P2)

A student who spots a mistake replaces their earlier submission with a new one. The new submission fully replaces the old one. Once an instructor has returned the submission, it is locked.

**Why this priority**: Students commonly upload the wrong file. Without resubmission they'd need an instructor to intervene, but the core flow works without it.

**Independent Test**: Submit, then submit again with different files, and check that only the second set of files is the student's current submission, the activity count is unchanged, and the old files are removed after a delay.

**Acceptance Scenarios**:

1. **Given** a student with a submission that hasn't been returned, **When** they open the assignment to resubmit, **Then** the form starts with their current files, and they can keep, remove or add files.
2. **Given** that form, **When** they submit the resulting 1–5 files, **Then** that set replaces the previous one as a whole and the submission's version goes up by one.
3. **Given** a resubmission that keeps some earlier files, **When** it succeeds, **Then** the kept files remain downloadable under the new version without the student re-uploading them.
4. **Given** a resubmission, **When** it succeeds, **Then** the student is not counted as active a second time.
5. **Given** a replaced submission, **When** the retirement delay passes, **Then** the old files are deleted, and a download link handed out just before the replacement keeps working until then.
6. **Given** a submission that has been returned, **When** the student tries to submit again, **Then** it is refused with a clear message.
7. **Given** two resubmissions from the same student at the same moment, **When** both are processed, **Then** exactly one wins and the other is told to retry, with no orphaned files left behind.

---

### User Story 3 - See and download my own submission (Priority: P2)

A student reopens the assignment later and sees what they submitted: file names, sizes, when it was submitted, and whether it was late. They can download their own files.

**Why this priority**: Students need to confirm what the instructor will see, and to retrieve their work.

**Independent Test**: Submit, reload the assignment, and check the submission details and a working download for each file. Then try to fetch another student's submission and files and confirm it's refused.

**Acceptance Scenarios**:

1. **Given** a student with a submission, **When** they open the assignment, **Then** they see their files, submitted time, late flag and version, and can download each file.
2. **Given** a student with no submission, **When** they open the assignment, **Then** they see the instructions, due date and the submit form.
3. **Given** two students in the same course, **When** one requests the other's submission or files, **Then** the request is refused or returns nothing.

---

### User Story 4 - Find assignments in the course outline (Priority: P3)

In the student portal's course outline, assignments stand out from lessons: they have their own icon, an "Assignment" label and the due date when there is one. Opening one goes straight to the submit form, not a list of content.

**Why this priority**: It makes assignments discoverable, but students could reach them without the markers.

**Independent Test**: View a module containing both lessons and an assignment with a due date and check the marking; open the assignment and check it lands on the submit form.

**Acceptance Scenarios**:

1. **Given** a module with lessons and an assignment, **When** a student views the outline, **Then** the assignment shows an icon, "Assignment" label, and its due date if set.
2. **Given** the outline, **When** the student opens the assignment, **Then** they land directly on the instructions and submit form.

---

### Edge Cases

- A student isn't enrolled, the course isn't published, or the assignment is hidden or archived (or its module or lesson is): submitting and viewing are refused as if it didn't exist for them.
- An upload that was started but never submitted: it expires on its own and never appears in any submission.
- A file listed in a submit request that is missing from the upload area, or whose type or size no longer matches what was allowed: the whole submission is refused.
- A student submits the same assignment from two tabs at once: only one result is saved.
- A submission arrives exactly at the due date: it counts as on time; late means strictly after.
- The assignment is changed by an instructor (due date moved, archived) after a student has submitted: the existing submission is kept; its late flag is not recomputed until the student next submits.
- A student who submitted on time resubmits after the due date: the submission becomes late. A student who submitted late and resubmits after an instructor extends the due date: the flag clears.
- A submission with zero files is refused.
- File names with accents, spaces or unusual characters still download under the student's original name.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Enrolled students MUST be able to submit 1 to 5 files to an upload assignment that is shown, in a published course, with no archived ancestor.
- **FR-002**: Each file MUST be at most 100 MB and of a type on the same allowlist as file content items; executables and HTML MUST be refused.
- **FR-003**: Files MUST be uploaded first and only become part of a submission when the student submits; the submit step MUST recheck each file's existence, type and size.
- **FR-004**: A submission MUST be recorded as one atomic change: the files, the submission record, the first-submission activity count and the item's completion all succeed or none do.
- **FR-005**: There MUST be at most one current submission per student per assignment, and a student MUST be able to read only their own.
- **FR-006**: A submission made after the assignment's due date MUST be accepted and flagged late; a submission without a due date is never late. The flag is worked out afresh on every submission, including resubmissions, so it always describes the latest submission.
- **FR-007**: A student's first submission to an assignment MUST count them once as active in the course; resubmissions MUST NOT count again.
- **FR-008**: Submitting MUST mark the assignment item complete for that student, so it counts towards lesson and course progress without waiting for grading.
- **FR-009**: A student MUST be able to resubmit while the submission has not been returned; each resubmission replaces the previous set of files as a whole and increases the submission's version. The resubmit form MUST start with the current files so the student can keep, remove or add files; files kept from an earlier version MUST NOT need re-uploading. There is no limit on the number of resubmissions; the version number records how many there were.
- **FR-010**: Replaced files MUST be retired after a delay, not immediately, so links already handed out keep working briefly.
- **FR-011**: Once a submission has been returned by an instructor, resubmission MUST be refused. (Returning itself is part 3.)
- **FR-012**: Concurrent resubmissions by one student MUST resolve to one winner; the loser's files MUST be cleaned up and the student told to retry.
- **FR-013**: Students MUST be able to view their own submission (files, submitted time, late flag, version) and download their own files through short-lived links, only while the assignment is shown with no hidden or archived ancestor; unlike submitting, this still works after the course is archived, as downloads of other content do. When it is hidden or archived the submission is kept but unavailable to the student, and it becomes available again if the content is shown again.
- **FR-014**: The student portal outline MUST distinguish assignments from lessons with an icon, an "Assignment" label and the due date if set, and opening one MUST go directly to the submit form.
- **FR-015**: The submission upload and the data-writing rules MUST follow the repository's shared-write and invariant conventions: the first-submission activity count is written through a shared helper and covered by an invariant check that a test can break.
- **FR-016**: This feature builds on the submission record already added by #294 and MUST NOT create a second, competing one; any change to it goes through the existing record.
- **FR-017**: The feature MUST work end to end in local development without an AWS account.
- **FR-018**: Instructor grading, feedback, points and the returned state's creation are out of scope; this feature only reads the returned state to lock resubmission.

### Key Entities

- **Assignment submission**: A student's current work for one upload assignment. Has the student, the assignment and course it belongs to, 1–5 files (name, size, type, location), submitted time, late flag, status (submitted or returned) and a version that increases with each resubmission. One per student per assignment. Looked up by assignment (for instructors, in part 3) and by student ("my submissions in this course").
- **Submission file**: One attached file, with its original name, size and type.
- **Upload assignment item**: Existing from #294; supplies the instructions, due date and maximum points the submission is judged against.
- **Student activity count**: Existing per-course tally of active students, which this feature increments once per student per assignment's first submission.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An enrolled student can go from opening an assignment to a confirmed submission of a typical document in under 2 minutes.
- **SC-002**: 100% of submissions to an assignment by a student who isn't enrolled, or in a hidden, archived or unpublished context, are refused.
- **SC-003**: 0 cases where a student can see or download another student's submission or files.
- **SC-004**: Across any number of resubmissions, each student is counted as active exactly once per assignment, and the data-consistency check passes after every test.
- **SC-005**: When two submissions race, exactly one is saved in 100% of runs and no files from the losing one remain after cleanup.
- **SC-006**: 100% of late submissions are flagged and 0% of on-time ones are.
- **SC-007**: Replaced files are gone within a day of replacement, and a link issued before the replacement works for at least the retirement delay.
- **SC-008**: A student can tell an assignment from a lesson in the outline at a glance, with the due date visible, in a usability check with at least 5 of 5 testers.

## Assumptions

- PR #294 has shipped upload assignment items (instructions, due date, maximum points) and assignment lessons; this feature builds on them.
- File uploads reuse the existing file-item rules: same allowed types, 100 MB per-file limit, the short-lived upload area, and the delayed cleanup.
- Resolving the issue's open decisions as written: completion on submit (decision 2), late work accepted and flagged (3), 5 files of 100 MB (4).
- Written notes with a submission (decision 6) are out of scope; a submission is files only. The issue treats it as optional, and it can be added later without changing this feature.
- Students can't withdraw a submission; they can only replace it.
- Only the "returned" state is read here; nothing in this feature sets it, so until part 3 ships resubmission is always allowed.
- Download links are valid for 5 minutes, as for file items.
- Issue #102 stays open until part 3; PRs for this feature must not use a closing keyword for it.
