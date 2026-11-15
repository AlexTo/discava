# Feature Specification: Real Courses on the Instructor Home Page

**Feature Branch**: `20261116-001229-instructor-home-real-courses` (spec only; implementation PRs branch from `main`)

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "Instructor portal home page lists the signed-in instructor's real courses (from the instructor's course list) instead of hard-coded mock data. The fake 'MTH201 · Applied Mathematics' card on the home page links to a course that doesn't exist and shows \"You don't have permission to do that.\""

**Parent issue**: #342

## Clarifications

### Session 2026-11-16

Resolved without asking, using the defaults below (non-interactive run).

- Q: Do archived courses appear on the home page and in its course count? → A: No. Home lists and counts only draft and published courses, so archived ones don't crowd out the few slots. Archived courses stay reachable (and restorable) in My Courses.

- Q: What happens to home-page sections that have no real data behind them (grading queue, upcoming, recent activity)? → A: They are removed, not kept as mock. Only content backed by real data is shown. Each returns when its own feature supplies the data.
- Q: Are the "Courses / Students / To grade" figures kept? → A: Only the course count is kept, since it is real. Student and to-grade figures are removed until real sources exist.
- Q: Do the quick actions stay? → A: Only "Create a course", the one that works today.
- Q: Does My Courses' mock detail (enrolment counts, ungraded counts) change here? → A: No. It is the same kind of problem but is its own change, noted as a follow-up.
- Q: Should opening a nonexistent course say "not found" instead of "permission denied"? → A: Out of scope here. It is a separate fix; this feature removes the way an instructor reaches such a link from the home page.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See my real courses when I open the portal (Priority: P1)

An instructor signs in and lands on the home page. They see the courses they actually teach, most recently updated first, each with its title, status (draft or published) and image if it has one. Choosing a course opens it in the course editor. They never see a course they don't teach.

**Why this priority**: This is the whole feature and the reported bug. A fake course that cannot be opened is the first thing an instructor sees, and it erodes trust in everything else.

**Independent Test**: Sign in as an instructor who teaches two courses and as one who teaches none. The first sees exactly their two courses, and each opens without error. The second sees an empty state. Neither sees any course title that isn't in their own course list.

**Acceptance Scenarios**:

1. **Given** an instructor who teaches several courses, **When** they open the home page, **Then** their courses are listed, most recently updated first, with title and status.
2. **Given** that list, **When** they choose a course, **Then** its editor opens with no permission error.
3. **Given** an instructor who teaches courses that other instructors also teach, **Then** those courses are listed for each of them.
4. **Given** an instructor who teaches no courses, **When** they open the home page, **Then** they see a clear empty state with a "Create a course" action, not blank space and not sample courses.
5. **Given** courses taught only by someone else, **When** this instructor opens the home page, **Then** those courses do not appear.
6. **Given** a course created from the home page, **When** creation succeeds, **Then** it appears in the list without a manual reload.

---

### User Story 2 - The home page shows nothing invented (Priority: P1)

Every number, title, name and date on the home page comes from real data. Sections that have no real data yet are not shown. The greeting uses the instructor's real name and today's date.

**Why this priority**: Same root cause as Story 1. Mock grading items, activity ("Mia Chen submitted…") and upcoming dates present false facts as true, so leaving them next to real courses would mislead.

**Independent Test**: Sign in as a brand-new instructor with no courses. The page shows no student names, course titles, counts or dates other than the greeting, today's date and an empty-state message.

**Acceptance Scenarios**:

1. **Given** any instructor, **When** they open the home page, **Then** no grading queue, upcoming dates or recent activity from sample data is shown.
2. **Given** an instructor with N courses, **When** the summary is shown, **Then** it reports N courses and no other made-up totals.
3. **Given** the page's introductory sentence, **Then** it makes no claim (such as "33 submissions waiting") that isn't backed by data.

---

### User Story 3 - Loading and failure are handled (Priority: P2)

While courses load, the instructor sees a loading state. If loading fails, they see an error with a way to retry, and the rest of the page stays usable.

**Why this priority**: Real data can be slow or fail, which mock data never did. Without this, an outage looks the same as "I have no courses", and an instructor might create a duplicate.

**Independent Test**: Delay, then fail, the course list request. The page shows loading, then an error with retry. Retrying with a working request shows the courses. The empty state is never shown for a failed load.

**Acceptance Scenarios**:

1. **Given** the course list is loading, **Then** a loading state is shown, not the empty state.
2. **Given** loading fails, **Then** an error message and a Retry action are shown, and the empty state is not.
3. **Given** the error, **When** the instructor chooses Retry and it succeeds, **Then** their courses are shown.

---

### Edge Cases

- An instructor teaches more courses than fit on the page: the home page shows the most recently updated few and a "View all courses" link to My Courses, which lists them all.
- A course appears in the instructor's list but was since deleted: it is skipped rather than shown as a broken card (the list already omits such gaps).
- An archived course is not listed on the home page or counted in its summary; it remains in My Courses, where it can be opened and restored.
- A course has no image: a neutral placeholder is shown.
- The user's profile has no name: the greeting falls back to a neutral welcome, not a made-up name.
- A student-only user who somehow reaches the portal sees no courses; the existing access rules for the portal are unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The home page MUST list the draft and published courses the signed-in instructor teaches, taken from their real course list, most recently updated first.
- **FR-002**: Each listed course MUST show its title and status, show its image when it has one, and open that course's editor when chosen.
- **FR-003**: The home page MUST NOT show any course, student, count, date or activity that is not backed by real data.
- **FR-004**: The sample grading queue, upcoming dates, recent activity, and the student and to-grade figures MUST be removed from the home page.
- **FR-005**: The summary MUST report the real number of draft and published courses the instructor teaches (archived excluded). With more than 100 courses the figure counts only the 100 most recently updated.
- **FR-006**: An instructor with no courses MUST see an empty state with a "Create a course" action.
- **FR-007**: The home page MUST show at most 6 courses and link to My Courses ("View all courses") for the full list.
- **FR-008**: The page MUST show a loading state while courses load, and an error with Retry when loading fails, never the empty state for a failed load.
- **FR-009**: A course created from the home page MUST appear in the list without a manual reload.
- **FR-010**: The quick actions MUST be limited to ones that work today ("Create a course").
- **FR-011**: The greeting MUST use the instructor's real name when known and a neutral welcome otherwise.
- **FR-012**: Buttons MUST carry text labels only, following the project's button convention.
- **FR-013**: Unit tests MUST cover: courses listed from real data, empty state, loading, error with retry, and no sample content present.
- **FR-014**: An end-to-end scenario MUST cover an instructor creating a course on the home page, seeing it listed, and opening it.

### Key Entities *(include if feature involves data)*

- **Course (as listed)**: A course the instructor teaches: title, status, image, last-updated time.
- **Instructor membership**: Links an instructor to a course they teach. It decides which courses appear, and who may open a course in the editor.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of courses shown on the home page can be opened by the instructor who sees them, with no permission error.
- **SC-002**: 0 sample names, titles, counts or dates appear on the home page for any instructor.
- **SC-003**: An instructor sees their courses within 3 seconds of the page opening on a normal connection (checked by hand, task T009).
- **SC-004**: A new instructor can go from sign-in to creating their first course in one step from the home page.
- **SC-005**: A failed load is never mistaken for "no courses": 100% of failures show an error with Retry.

## Assumptions

- The instructor's existing course list (the one My Courses already uses) is the data source; no new data or storage is needed.
- "Most recently updated first" is the existing ordering of that list.
- My Courses remains the full list; Home is capped at 6 (FR-007).
- Removed sections come back as their own features once real data exists (grading queue with assignment grading, activity with enrolment events).
- My Courses (per-course enrolment and ungraded figures) and the dashboard page (seeded figures) still show sample data. Replacing those is a follow-up, not part of this feature.
- Making opening a nonexistent course report "not found" rather than "permission denied" is a separate follow-up.
