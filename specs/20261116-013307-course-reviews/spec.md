# Feature Specification: Course Ratings and Written Reviews

**Feature Branch**: `spec/reviews` (spec only; implementation PRs branch from `main`)

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "Issue #279: course ratings and written reviews. Enrolled students leave one 1-5 rating plus an optional text review per course (editable, deletable). The course carries an aggregate rating and count, kept consistent through a core-table helper. Shown on catalogue cards, the course page and as a search sort/boost. The instructor can respond; an admin can remove abusive reviews. One review per student per course under concurrency; an average/count invariant in `helpers/invariants.ts`."

**Parent issue**: #279

## Clarifications

### Session 2026-11-16

Resolved without asking, using the recommended answers below (non-interactive run).

- Q: Must a student have made progress before they may review? → A: No. Any student whose enrolment is not dropped may review, with no minimum progress, as the issue says "enrolled students". A progress threshold is a follow-up if fake reviews appear.
- Q: What happens to a review an admin removes? → A: It stays as a hidden record (status removed, with the reason) that is excluded from every public view and from the summary, and it blocks the author from posting another on that course. A student's own delete removes the record entirely.
- Q: Where does an admin find and remove reviews? → A: A "Reviews" screen in the admin portal: pick a published or archived course, see all its reviews (removed ones marked), remove with a reason. There is no cross-course moderation queue and no student "report" button.
- Q: How is a course's rating weighted for "Highest rated" and the relevance boost? → A: A weighted rating that treats every course as having five extra ratings averaging 3.5: `(count x average + 5 x 3.5) / (count + 5)`. A course with no ratings gets no boost and sorts after rated courses under "Highest rated". The card and page show the plain average.
- Q: Which minimum-rating filter values does the catalogue offer? → A: 4.5 and up, 4.0 and up, 3.5 and up, 3.0 and up, applied to the plain average. Unrated courses never match a rating filter.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Rate and review a course I am enrolled in (Priority: P1)

A student enrolled in a course gives it 1 to 5 stars and may add a written review. They can change both later, or delete the review and start again. A course page shows the course's average rating, how many ratings it has, and the written reviews.

**Why this priority**: The review record and its one-per-student rule are the feature. Everything else (cards, search, responses, moderation) reads or adds to it.

**Independent Test**: As an enrolled student, post a 4-star review with text, see it on the course page with the course's average and count, edit it to 5 stars, delete it, and check the count and average follow each step. As a student who is not enrolled, or who dropped the course, try to post and be refused.

**Acceptance Scenarios**:

1. **Given** a student enrolled in a course and not yet reviewing it, **When** they submit a rating (1 to 5) with or without text, **Then** their review appears on the course page and the course's average and count include it.
2. **Given** a student with a review, **When** they change the rating or text, **Then** the review shows the new content with an "edited" mark, and the average and count reflect the new rating exactly once.
3. **Given** a student with a review, **When** they delete it, **Then** it disappears, the average and count drop it, and they may post a new one.
4. **Given** a student who is not enrolled, or has dropped the course, **When** they try to post a review, **Then** it is refused. A signed-out visitor can read reviews but not post.
5. **Given** a student submitting twice at the same moment (two tabs, a double click, a retry), **Then** exactly one review exists and the course's count rose by one.
6. **Given** a rating outside 1 to 5, a fractional rating, or text over the length limit, **Then** it is refused with a clear message and nothing is saved.

---

### User Story 2 - See ratings when choosing a course (Priority: P1)

A visitor browsing the catalogue sees each course's average rating and rating count on its card, sees the same summary (with a breakdown by star) and the reviews on the course page, and can search or sort courses by rating.

**Why this priority**: Social proof is the reason for the feature. Without it, reviews are collected and not used.

**Independent Test**: With two published courses, one rated and one not, open the catalogue signed out: the rated card shows its average and count and the other shows no rating. Search with sort by rating: the better-rated course comes first. Open the course page: summary, star breakdown and reviews.

**Acceptance Scenarios**:

1. **Given** a course with ratings, **When** a visitor (signed in or not) views a catalogue or search card, **Then** it shows the average (one decimal) and the count.
2. **Given** a course with no ratings, **Then** its card and page show "No ratings yet" and no number.
3. **Given** a course page, **Then** it shows the average, the count, how many ratings each star value has, and the course's reviews newest first, a page at a time, with each reviewer's display name and date.
4. **Given** search results, **When** the visitor picks "Highest rated", **Then** results are ordered by rating (a course with few ratings does not outrank a well-rated one on a single vote). With the default ordering, ratings modestly lift well-rated courses among similarly relevant results.
5. **Given** the catalogue's filters, **When** the visitor filters by a minimum rating (4.5, 4.0, 3.5 or 3.0 and up), **Then** only rated courses whose average is at or above it show.
6. **Given** a rating changes, **Then** the card, the page and search reflect it within a minute.

---

### User Story 3 - Instructor responds to reviews (Priority: P2)

An instructor of a course sees its reviews in the instructor portal and writes one public response to a review, which they can edit or delete. The response shows beneath the review everywhere it appears.

**Why this priority**: Required by the issue and good practice, but the ratings stand without it.

**Independent Test**: As an instructor of the course, respond to a review, see the response on the course page, edit it, delete it. As another instructor, or a student, try to respond and be refused.

**Acceptance Scenarios**:

1. **Given** a course's reviews, **When** one of its instructors writes a response, **Then** the review shows it, with the instructor's name and date.
2. **Given** a response, **When** its instructor edits or deletes it, **Then** the review shows the change.
3. **Given** a user who is not an instructor of the course, **When** they try to respond, **Then** it is refused.
4. **Given** a student edits their review after a response, **Then** the response stays.
5. **Given** a review the student has deleted or an admin has removed, **Then** it cannot be responded to.

---

### User Story 4 - Admin removes an abusive review (Priority: P2)

An admin finds a course's reviews in the admin portal and removes one that breaks the rules, with a short reason. The review leaves every public view and the ratings, and its author cannot post another on that course.

**Why this priority**: Required by the issue; a public review feature needs a way to take content down.

**Independent Test**: As an admin, remove a review with a reason; check the course page, card, search and summary no longer include it, that the author sees it was removed and cannot repost, and that a non-admin cannot remove.

**Acceptance Scenarios**:

1. **Given** an admin viewing a course's reviews (removed ones marked), **When** they remove one with a reason, **Then** it disappears from public views and the average and count drop it.
2. **Given** a removed review, **Then** its author sees a "removed by a moderator" notice with the reason, and cannot edit, delete or repost it.
3. **Given** a user who is not an admin, **When** they try to remove a review, **Then** it is refused, including instructors of that course.
4. **Given** a removed review, **When** the admin removes it again, **Then** nothing changes.
5. **Given** a review with an instructor response, **When** it is removed, **Then** the response is hidden with it.

---

### User Story 5 - Instructor hears about new reviews (Priority: P3)

When a student posts a review of a course, its instructors get an in-app notification (not an email by default) linking to the course's reviews.

**Why this priority**: Nice to have and depends on the notifications feature (#331) being built; it adds nothing the review list lacks.

**Independent Test**: With notifications built, post a review and check each instructor of the course has one notification for it, and that editing the review adds none.

**Acceptance Scenarios**:

1. **Given** a new review, **Then** each instructor of the course gets one notification with the course title and the rating.
2. **Given** an edit, a delete or a repeat of the same request, **Then** no further notification is created.

---

### Edge Cases

- Two reviews by one student racing: one wins, the other is told they already have a review (and may edit it).
- Edit racing a delete, or two edits: the loser is told the review changed and re-reads; the summary stays right.
- Edit racing an admin removal: the removal wins; the edit is refused.
- A student drops a course after reviewing: the review stays and counts; they cannot post a new one while dropped. They may still edit or delete the one they have.
- A course is archived: its reviews stay readable; new reviews are not accepted for it.
- A student's display name changes after posting: the review keeps the name it had when posted.
- Text with only whitespace counts as no text (a rating-only review).
- A course with no ratings: no average, no star breakdown, search ranking treats it as unrated (neither boosted nor penalised below its relevance).
- Search is starting up (it scales to zero): the visitor gets the same retriable message as today.
- A review text containing markup or links is shown as plain text, never as markup.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A student whose enrolment in a course is not dropped MUST be able to post one review of it: a whole-number rating from 1 to 5 and optional plain text of at most 2,000 characters. A student MUST NOT have more than one review per course, including under concurrent requests.
- **FR-002**: A student MUST be able to edit their rating and text and to delete their review. An edit MUST fail, not overwrite, if the review changed since the student read it.
- **FR-003**: A course's rating summary (the number of ratings at each star value, from which the average and count follow) MUST be kept equal to its visible reviews by every write that creates, edits, deletes or removes a review, through one shared `core-table` helper that every writer calls, in the same transaction as the review write. Changing the summary MUST NOT change the course's own last-updated time or anything the instructor course lists derive from it.
- **FR-004**: An invariant check, which a test can break, MUST cover that each course's summary equals the tally of its visible reviews, that there is at most one review per student and course, that each review's rating is in range and its student is enrolled, and that a removed review is not counted.
- **FR-005**: Anyone, signed in or not, MUST be able to read a course's summary and its visible reviews (display name, rating, text, date, edited mark, instructor response), newest first, paged. Responses and reviews MUST never expose email addresses or user IDs.
- **FR-006**: Catalogue cards, search results and the course page MUST show the average (one decimal) and count of a rated course and "No ratings yet" otherwise. Cards MUST NOT cost a read per course beyond the page of cards already being shown.
- **FR-007**: Search MUST support ordering by rating, ordering by newest and by relevance (default with text), and filtering by a minimum plain average (4.5, 4.0, 3.5 or 3.0 and up; unrated courses never match). Ordering by rating and the relevance boost MUST use the weighted rating `(count x average + 5 x 3.5) / (count + 5)`, so a course with one 5-star rating does not outrank a course with many 4.8 ratings; unrated courses get no boost and sort after rated ones. A course's search entry MUST update when its summary changes.
- **FR-008**: One of a course's instructors MUST be able to write, edit and delete a single public response on any visible review of the course; nobody else can. A response MUST NOT change a review's rating, text, edited mark or the summary.
- **FR-009**: An admin MUST be able to remove any review with a reason (at most 200 characters). A removed review MUST leave public views, the instructor's response list and the summary, MUST show its author a removed notice with the reason (the reason is visible only to the author and admins, never public), and MUST block that student from posting another review of the course. Removal is idempotent.
- **FR-009a**: The admin portal MUST offer a Reviews screen: choose a published or archived course, list all its reviews (removed ones marked, with reason), and remove one.
- **FR-010**: Instructors of a course MUST be able to list its reviews, with each rating, text and whether it has a response, in the instructor portal.
- **FR-011**: When a review is created, each instructor of the course SHOULD get one in-app notification through the notifications feature's producer helper, deduplicated so a retry creates none more, and none for edits or deletes. This part is delivered only once that feature exists.
- **FR-012**: Posting MUST be refused for a course that is not published, and editing and deleting remain allowed. Reviews MUST remain readable for archived courses.
- **FR-013**: The reviewer's display name MUST be the given name and the first letter of the family name as on the user record when posted ("Alex T."), "Discava learner" if none; never the email. It MUST NOT change on later edits to the user or the review.
- **FR-014**: The feature MUST work end to end in local development without an AWS account, including search ordering and the admin screen.
- **FR-015**: The feature MUST NOT add reporting buttons for students, review votes ("helpful"), images, review emails, moderation queues or course-level review switches (see Assumptions).

### Key Entities

- **Review**: One per student per course. Has the rating, optional text, when it was posted and last edited, the reviewer's display name as posted, an optional instructor response, and a status (visible or removed, with the removal reason).
- **Course rating summary**: One per course that has ratings. The count of visible reviews at each star value; the average and total follow from it.
- **Instructor response**: Optional text, author and time attached to a review.
- **Enrolment** and **Course**: Existing. The enrolment decides who can post; the course decides whether posting is open and who can respond.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of runs, however many creates, edits, deletes and removals run concurrently, each course's summary equals its visible reviews and no student has two reviews of a course, and the data-consistency check passes after every test.
- **SC-002**: A rating change shows on the course page immediately for the author, and on cards and in search within 60 seconds.
- **SC-003**: A student can post a review in under a minute from the course page, and edit or delete it in two actions.
- **SC-004**: 0 cases where a student not enrolled, a dropped student, a non-instructor or a non-admin completes a restricted action.
- **SC-005**: 100% of removed reviews are absent from public views, summaries and search ordering.
- **SC-006**: Catalogue and course pages show ratings without a visible slowdown: cards for a page of courses load together with the page.

## Assumptions

- "Enrolled" means an enrolment that is not dropped (active or completed). There is no minimum progress to review; the issue does not ask for one.
- Reviews are plain text, 2,000 characters at most, with no title and no images. A rating-only review is allowed.
- Reviews are public by design: any visitor reads them, with the short display name.
- A student's own deletion removes the review entirely; an admin removal keeps a hidden record so the author cannot repost.
- Review authors are not notified of instructor responses in this feature, and only new reviews notify instructors (US5, after #331). Adding a response notification type is a follow-up to that registry.
- Search and catalogue filters build on the existing search; where the catalogue filters spec (#333) changes the same search procedure and index, the changes are additive and whichever lands second adapts.
- Admin moderation needs a backend for the admin portal, which does not exist yet. The catalogue categories spec (#333) also needs one; whichever feature lands first generates it and the other reuses it.
- Out of scope: reporting or flagging by students, helpfulness votes, verified-completion badges, review emails, moderation queues, course-level review switches, ratings on My Learning or on the instructor dashboard (#332), and replies by students.
- Discava has not launched: no old data to preserve, so entities, attributes and routes are added outright.
- Only the final implementation PR may close #279.
