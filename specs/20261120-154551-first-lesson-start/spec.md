# Feature Specification: Start in Lesson One After Enrolling

**Feature Branch**: `20261120-154551-first-lesson-start` (spec only; implementation PRs branch from `main`)

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "Issue #596, feat(student-portal): start in lesson one after enrolling, with a content prompt in the first Q&A. After enrolling (free or paid) the learner lands in the first shown lesson with the first item ready to play, not on the course home or My Learning; a course with no shown lessons falls back to the course home; returning learners still resume where they left off. The first lesson's Q&A shows a prompt inviting a post about the content; instructors can edit the prompt per course; the default asks what the learner wants to be able to do with the topic. The prompt is shown until the learner posts or dismisses it, only in the first lesson, and never returns. Instructor analytics show how many enrolled learners completed their first item (activation), beside the drop-off funnel. Out of scope on purpose: reminders, goal-setting and plan-making prompts."

**Parent issue**: #596

**Design page**: [`design/course-analytics`](../../docs/src/content/docs/en/design/course-analytics.mdx) (gains the "Activation" definitions); the learner and instructor guides ([`guides/lesson-discussions`](../../docs/src/content/docs/en/guides/lesson-discussions.mdx)) gain the prompt.

**Extends**: the lesson discussions spec ([`20261116-013334-lesson-discussions`](../20261116-013334-lesson-discussions/spec.md), built) and the instructor dashboard spec ([`20261115-210425-instructor-dashboard`](../20261115-210425-instructor-dashboard/spec.md), built). **Touches the same course page as** the Stripe checkout spec ([`20261116-013315-stripe-checkout`](../20261116-013315-stripe-checkout/spec.md), part built). See [How this fits the checkout spec](#how-this-fits-the-checkout-spec).

## Why

The largest loss of learners happens before learning starts: many people who enrol never open a lesson (issue #596 has the evidence). Today, enrolling ends in a "You're enrolled!" dialog whose **Start learning** button opens the course home, where the learner must press **Start** again to reach a lesson. This feature removes those two stops, and gives the learner one small thing to do in the first lesson that is about the course's content.

The effects reported in the research are small and happen early, so the feature is kept small too.

## How this fits the checkout spec

The checkout spec's student portal buy flow (its Phase 7) is merged: the course page already shows **Buy now**, the "Confirming your payment" state, and the same "You're enrolled!" dialog once the payment's enrolment appears. This spec changes what happens at that last moment, for free and paid courses alike: the dialog goes away and the learner is taken to their lesson. Everything before that moment (price line, payment, waiting, the 60-second message, cancelled payments) is unchanged.

The checkout spec's remaining student portal phases (9, 10, 12 and 13: cancelled payments, ended enrolments, refunds, leaving a course) add other states to the same component. None of them touches the moment of enrolling, so they and this spec's Phase 1 can merge in either order; whichever merges second resolves a small text conflict. The checkout contract's row "on the enrolment appearing, the enrolled state and the usual enrolled dialog" is replaced by this spec's [contracts/student-portal-ui.md](./contracts/student-portal-ui.md).

## Clarifications

### Session 2026-11-20

Resolved without asking, using the recommended defaults (non-interactive run).

- Q: Which lesson does a learner land in after enrolling? → A: The lesson the course would offer under "Start" or "Continue": the first lesson shown to students, in course order, that the learner has not completed. For someone new that is the first shown lesson. For someone coming back to a course they had left, it is where they left off.
- Q: What if the course has no lesson shown to students? → A: The learner lands on the course home, which already says "No lessons yet".
- Q: What does "the first item ready to play" mean? → A: The lesson opens with its first item at the top of the page and its player loaded, with nothing to dismiss first. A video does not start by itself: browsers block sound that starts without a click, and an unexpected video is a problem for people using a screen reader or a shared room.
- Q: What happens to the "You're enrolled!" dialog and its "Keep browsing" choice? → A: The dialog is removed. The lesson page shows a short line once, "You're enrolled in <course>.", so the learner still gets a confirmation, which matters most after paying. There is no "Keep browsing": the catalogue is one click away in the top bar.
- Q: After paying, when does the learner move to the lesson? → A: As soon as the payment's enrolment appears, from the "Confirming your payment" state, with no click. A learner who arrives back from the payment page already enrolled moves at once too. The waiting and "still being confirmed" states stay as they are. The return address is replaced in the browser's history, so Back does not bounce the learner into the lesson again.
- Q: What is an answer to the prompt? → A: A post in the first lesson's Q&A, written in one text box (no title to think of). It appears in the lesson's list for classmates and instructors, labelled as an answer to the course prompt, and classmates can reply to it and upvote it like any question.
- Q: Do prompt answers go into the instructor's Unanswered queue? → A: No. They are not questions waiting for an instructor, and a busy course would bury real questions under them. Instructors read them in the Questions area's By lesson view, and can reply, hide or delete them like any post. A reported one appears in the Reported queue as usual.
- Q: Who sees the prompt? → A: A learner with an enrolment that has not ended, in the first lesson shown to students, while the course is published. Instructors who are not enrolled, and anyone reading an archived (read-only) course, never see it. Learners who enrolled before this feature see it once too, if they open the first lesson.
- Q: How many times can a learner answer, and can they bring the prompt back? → A: Once per course. Answering or pressing **Not now** closes the prompt for good for that learner and course, on every device. There is no "show again". Deleting their answer does not bring it back.
- Q: What if the instructor reorders lessons, or hides the first one? → A: The prompt is shown in whichever lesson is first at that moment. Answers already posted stay in the lesson they were posted in.
- Q: What can an instructor change? → A: The prompt's text for one course: plain text, 1 to 200 characters. Clearing it brings back the default. Changing it does not show the prompt again to learners who already answered or dismissed it. There is no switch to turn the prompt off (open question for the maintainer in the PR).
- Q: What is the default text? → A: "What do you want to be able to do with what this course teaches? Tell the class in a sentence or two." It is the same for every course that has no text of its own, so improving the default later changes all of them at once.
- Q: What exactly is "activation"? → A: An enrolment whose learner has done a first thing in the course: completed an item (which includes submitting an assignment) or submitted a quiz attempt. This is the dashboard's existing definition of an active learner, applied once per enrolment for all time. The issue says "completed their first item"; the only difference is a learner whose one action was a quiz attempt they did not pass, who counts as activated here.
- Q: Who is in the activation rate? → A: Every enrolment the course has had, including those that later ended, like "Enrolments" on the same page: a learner who started and then left did start. The rate is activated enrolments divided by all enrolments, and shows "No data" when there are none.
- Q: Is there a time limit, such as "within 7 days of enrolling"? → A: No. Activation is counted whenever it happens. The page says "so far", because learners who enrolled recently have had less time.
- Q: How will the owner tell whether this helped? → A: The analytics page shows activation for all time and for learners who enrolled in the last 30 or 90 days, plus how many learners answered and dismissed the prompt. Figures are rebuilt from the records, so enrolments from before this feature are included, and the owner can compare learners who enrolled before and after it shipped. No experiment or control group is built.
- Q: Does the learner know who will read their answer before they post it? → A: Yes. Under the text box the prompt says "Everyone in this course can read your answer.", and the default text says "Tell the class".
- Q: Is the enrolment confirmed when the course has no lessons and the learner lands on the course home? → A: Yes. The same line, "You're enrolled in <course>.", is shown once on the course home.
- Q: Does the prompt take keyboard focus or interrupt a screen reader when the lesson opens? → A: No. Focus stays where the lesson page puts it today, so the first item comes first. The prompt is a labelled form reached in page order, and the confirmation line is announced politely, without moving focus.
- Q: Is the prompt shown while the learner has a question's thread open, or when the lesson's questions fail to load? → A: No. It is shown with the lesson's list of questions only, where the ask form is shown today.
- Q: Are reminders, goals or study plans part of this? → A: No, on purpose (issue #596): the largest test found they raise early engagement but not completion. Nothing here emails, notifies or schedules anything.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Land in the lesson straight after enrolling (Priority: P1)

A signed-in visitor on a course page presses **Enrol now** (a free course) or pays for it (a priced course). They are taken straight to the first lesson, with its first item at the top of the page ready to play and a line confirming they are enrolled. No dialog, no course home in between.

**Why this priority**: This is the core of the issue, and it needs no new data: it only changes where the portal sends the learner.

**Independent Test**: Enrol in a free published course with at least one shown lesson and confirm the next page is that lesson. Repeat with a priced course through the local payment stand-in.

**Acceptance Scenarios**:

1. **Given** a free published course with shown lessons, **When** a signed-in visitor presses **Enrol now**, **Then** the first shown lesson opens, with the line "You're enrolled in <course>." and no dialog.
2. **Given** a priced course, **When** the learner returns from a successful payment and the enrolment appears, **Then** the first shown lesson opens without a click.
3. **Given** a course whose first module or first lesson is hidden or archived, **When** a learner enrols, **Then** the lesson that opens is the first one students can see.
4. **Given** a course with no lesson shown to students, **When** a learner enrols, **Then** the course home opens, confirms the enrolment and says there are no lessons yet.
5. **Given** a learner who left a course after completing its first two lessons, **When** they enrol again, **Then** the third lesson opens. (The course page offers enrolling again only once the checkout spec's Phases 10 and 13 are built; until then this rule is tested where the landing page is chosen.)
6. **Given** an enrolled learner with progress, **When** they open the course from My Learning or the course page, **Then** they resume where they left off, exactly as today.
7. **Given** the payment has not been confirmed yet, **When** the learner is back on the course page, **Then** they see "Confirming your payment" as today, and are not moved until the enrolment appears.
8. **Given** a learner landed in a lesson after paying, **When** they press the browser's Back button, **Then** they are not sent into the lesson again.

---

### User Story 2 - Answer a prompt about the content in the first lesson (Priority: P2)

In the first lesson's Questions section, an enrolled learner sees a prompt above the list, for example "What do you want to be able to do with what this course teaches?", with one text box, **Post** and **Not now**. Posting adds their answer to the lesson's list. Either button closes the prompt for good.

**Why this priority**: It is the second intervention in the issue. It builds on the existing Q&A, and Story 1 delivers value without it.

**Independent Test**: As a newly enrolled learner, open the first lesson, answer the prompt, and confirm the answer is in the list and the prompt is gone, also after signing in on another browser.

**Acceptance Scenarios**:

1. **Given** an enrolled learner who has neither answered nor dismissed the prompt, **When** they open the first shown lesson, **Then** the prompt is shown above the lesson's questions, says that everyone in the course can read the answer, and has not taken focus.
2. **Given** the prompt is shown, **When** the learner writes an answer and presses **Post**, **Then** the answer appears in the lesson's list, marked as an answer to the course prompt, and the prompt disappears.
3. **Given** the prompt is shown, **When** the learner presses **Not now**, **Then** the prompt disappears and nothing is posted.
4. **Given** a learner who answered or dismissed the prompt, **When** they open the first lesson again, on any device, **Then** the prompt is not shown.
5. **Given** any lesson other than the first shown one, **When** an enrolled learner opens it, **Then** no prompt is shown.
6. **Given** a learner tries to answer twice (two tabs, or a direct request), **When** the second answer arrives, **Then** it is refused and only one answer exists.
7. **Given** a prompt answer, **When** an instructor opens the Unanswered queue, **Then** the answer is not in it; it is in the By lesson view.
8. **Given** an instructor who is not enrolled, or anyone in an archived course, **When** they open the first lesson, **Then** no prompt is shown.

---

### User Story 3 - See how many learners got started (Priority: P2)

An instructor opens a course's analytics page. Beside the drop-off funnel, an Activation section says how many enrolled learners have done a first thing in the course, as a count and a share, for all time and for learners who enrolled in the selected 30 or 90 days. It also says how many answered and how many dismissed the first-lesson prompt.

**Why this priority**: Without it nobody can tell whether Stories 1 and 2 changed anything. It is independent of them: activation is counted from records that exist today.

**Independent Test**: With three enrolments of which one has completed an item, the page shows "1 of 3 (33%)".

**Acceptance Scenarios**:

1. **Given** a course with 3 enrolments, one of which has completed an item, **When** the instructor opens its analytics, **Then** Activation shows 1 of 3 and 33%.
2. **Given** a learner's first action is a submitted quiz attempt, **When** the figures update, **Then** that learner counts as activated.
3. **Given** an activated learner completes more items, **When** the figures update, **Then** the activated count does not change.
4. **Given** an activated learner's enrolment ends, **When** the figures update, **Then** they still count as activated and as an enrolment.
5. **Given** a course with no enrolments, **When** the page loads, **Then** Activation shows "No data", not 0%.
6. **Given** two learners answered the prompt and one dismissed it, **When** the page loads, **Then** it shows 2 answers and 1 dismissal.
7. **Given** someone who does not teach the course, **When** they ask for its analytics, **Then** they get nothing, as today.

---

### User Story 4 - Write the prompt for my course (Priority: P3)

An instructor opens a course's settings, sees the first-lesson prompt with the default text, replaces it with a question about their own course, and saves. New learners see the instructor's text.

**Why this priority**: The default works for every course, so this is a refinement. The issue asks for it, and it is small.

**Independent Test**: Save a custom prompt as the instructor, then open the first lesson as a newly enrolled learner and see that text.

**Acceptance Scenarios**:

1. **Given** a course with no text of its own, **When** the instructor opens its settings, **Then** the form shows the default text and says it is the default.
2. **Given** the instructor saves "Which dataset do you want to analyse first?", **When** a learner who has not closed the prompt opens the first lesson, **Then** they see that text.
3. **Given** a custom text, **When** the instructor clears the field and saves, **Then** the default is back.
4. **Given** text longer than 200 characters, **When** the instructor saves, **Then** it is refused with the rule, and the previous text stays.
5. **Given** someone who does not teach the course, **When** they try to change its prompt, **Then** they are refused.

---

### Edge Cases

- **Course unpublished or lesson hidden between enrolling and landing**: the learner sees what the lesson page already shows for a lesson that is no longer available, with the way back to the course.
- **Signed-out visitor**: enrolling still goes through sign-in and back to the course page first, as today. The move to the lesson happens when the enrolment is made.
- **Payment confirmed late**: after the 60-second "still being confirmed" message, the learner refreshes. If they are enrolled by then, they are taken to their lesson, like any learner who returns from paying already enrolled.
- **Bookmarked return address**: opening the payment return address again later, already enrolled, takes the learner to where they left off, never back to lesson one if they have moved on.
- **First lesson has no items**: the learner still lands there. The page says there is nothing in the lesson yet, and the prompt is shown.
- **Answer and dismissal at the same moment (two devices)**: one wins. The learner ends with either one answer or none, never both states.
- **Empty or too-long answer**: refused with the same messages as a question's details (1 to 4,000 characters), and what was typed is kept.
- **Answer hidden or deleted by an instructor, or deleted by its author**: the prompt does not come back.
- **Enrolment ended (refund or leaving)**: the learner can no longer open the lesson, so they see no prompt. If they enrol again, a prompt they already closed stays closed.
- **Course archived**: lessons are read-only, so the prompt is not shown.
- **First lesson changes after a learner answered**: their answer stays in the old first lesson's list. They are not asked again.
- **Figures for old enrolments**: activation counts enrolments from before this feature once the course's figures are rebuilt.

## Requirements *(mandatory)*

### Functional Requirements

**Landing after enrolling**

- **FR-001**: After a learner enrols in a free course, the student portal MUST open the first lesson shown to students, in course order, that the learner has not completed, without an intermediate dialog or the course home.
- **FR-002**: After a paid enrolment appears, the portal MUST open the same lesson without a click, whether the enrolment appears while the learner waits or was already there when they returned from paying.
- **FR-003**: When the course has no lesson shown to students, the portal MUST open the course home.
- **FR-004**: The lesson MUST open with its first item at the top and ready to use, and MUST NOT start playing media by itself.
- **FR-005**: The page the learner lands on (the lesson, or the course home when there is no lesson) MUST confirm the enrolment once ("You're enrolled in <course>.") when they arrive from enrolling, and not on later visits. The line MUST be announced to assistive technology without moving focus.
- **FR-006**: Opening a course by any other route (My Learning, the course page's button for an enrolled learner, the course home) MUST behave as today, so returning learners resume where they left off.
- **FR-007**: The move to the lesson after paying MUST replace the payment return address in the browser's history.
- **FR-008**: The payment waiting, timed-out, cancelled and unavailable states MUST stay as the checkout spec defines them. A return address alone, without an enrolment, MUST NOT open a lesson.

**The first-lesson prompt**

- **FR-009**: The first lesson shown to students MUST show a prompt in its Questions section to a learner whose enrolment has not ended and who has neither answered nor dismissed it, while the course is published. No other lesson shows it.
- **FR-010**: The prompt MUST offer one labelled text field, **Post** and **Not now**, with text labels only, and MUST say that everyone in the course can read the answer. It MUST NOT take focus when the page opens, and is shown only with the lesson's list of questions (not inside an open thread, and not when the list failed to load).
- **FR-011**: Posting MUST create one post in that lesson's Q&A, visible to everyone who can read the lesson's questions, marked as an answer to the course prompt, and open to replies, upvotes, reports and moderation like any question.
- **FR-012**: A prompt answer MUST NOT appear in the instructor's Unanswered queue or count as an unanswered question.
- **FR-013**: Whether a learner answered or dismissed the prompt MUST be remembered per learner and course on the server, so it holds on every device and browser, and MUST never be undone: not by deleting or hiding the answer, changing the prompt's text, reordering lessons, or ending and renewing the enrolment.
- **FR-014**: A learner MUST be able to answer at most once per course. A second answer, or an answer after dismissing, MUST be refused, also when two requests arrive at the same moment.
- **FR-015**: The server MUST refuse an answer from anyone who could not post a question in that lesson, from anyone without an enrolment of their own (an instructor who is not enrolled included), and an answer aimed at a lesson that is not the first shown lesson.
- **FR-016**: The prompt's text MUST be the course's own text when the instructor has set one, and otherwise the default: "What do you want to be able to do with what this course teaches? Tell the class in a sentence or two."
- **FR-017**: Posting or dismissing MUST NOT count as learning activity: it changes no progress, completion, "last active" time or activation figure.

**The instructor's text**

- **FR-018**: An instructor of a course MUST be able to set its prompt text (plain text, 1 to 200 characters after trimming) and to clear it back to the default, in any course status. Nobody else may.
- **FR-019**: The course's settings MUST show the text learners currently see and whether it is the default.

**Activation**

- **FR-020**: The course analytics page MUST show, beside the drop-off funnel, how many enrolments are activated (the learner completed an item or submitted a quiz attempt at least once), as a count and as a share of all the course's enrolments, for all time and for enrolments made in the selected 30 or 90 days.
- **FR-021**: The page MUST show how many learners answered and how many dismissed the first-lesson prompt.
- **FR-022**: Each enrolment MUST count as activated at most once, however many things the learner does, and MUST stay counted when the enrolment ends.
- **FR-023**: The activation and prompt figures MUST follow the same rules as the dashboard's other figures: kept up to date as records change rather than counted per request, unaffected by repeated or reordered deliveries of a change, equal to what a rebuild from the records gives, covered by the same consistency check, readable only by the course's instructors, and never identifying a learner.
- **FR-024**: A share with no enrolments behind it MUST show "No data", not 0%.

**Boundaries**

- **FR-025**: The feature MUST NOT send reminders, emails or notifications, and MUST NOT ask learners to set goals or make study plans.
- **FR-026**: Everything MUST work in local development with no AWS account.

### Key Entities

- **Enrolment** (existing): gains what the learner did with the first-lesson prompt: nothing yet, answered, or dismissed. Its existing "last active" time already says whether the learner has started.
- **Course** (existing): gains an optional prompt text of its own. Without one, the default applies.
- **Discussion post** (existing): a question can be marked as an answer to the course prompt, which keeps it out of the Unanswered queue.
- **Course figures** (existing, all-time and per day): gain activated enrolments, prompt answers and prompt dismissals. Nothing new is stored per learner.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A learner reaches the first lesson's first item with zero clicks after the enrolment is made (today: two, **Start learning** then **Start**), in a free course and after a confirmed payment.
- **SC-002**: In tests covering a new learner, a learner with progress and a course with no shown lessons, the page that opens after enrolling is the right one in 100% of cases.
- **SC-003**: A prompt that was answered or dismissed is shown again in 0 cases, checked across two separate browser sessions of the same learner.
- **SC-004**: No learner ever has more than one prompt answer in a course, including when two answers are sent at the same moment.
- **SC-005**: 0 prompt answers appear in any Unanswered queue.
- **SC-006**: For every course in the test data, the activation and prompt figures equal the figures counted directly from the records, in 100% of the consistency checks run after every end-to-end test.
- **SC-007**: An instructor can read a course's activation share for all time and for the last 30 days in under 30 seconds from opening its analytics page.
- **SC-008**: Thirty days after release, the owner can compare the activation share of learners who enrolled since release (the 30-day range) with that of learners who enrolled in the 90 days that include the time before it, from the analytics page alone.

## Assumptions

- Only the student portal's course page enrols learners, so that is the only place the landing changes.
- A signed-out visitor still signs in and returns to the course page before enrolling. Enrolling automatically on return is out of scope.
- The first lesson is decided when the page is shown. There is no setting to pick a different "welcome" lesson.
- A prompt answer is plain text with the same limits and moderation as a question's details. Its title in lists is taken from its first line.
- Prompt answers notify nobody when posted. Replies to one notify its author, as replies to any question do.
- Activation is counted from the "last active" time enrolments already carry, so it needs no new record per learner and no change to how activity is recorded.
- No experiment, control group or per-learner report is built. Before-and-after comparison by enrolment date is enough for an effect this size.
- The prompt cannot be switched off per course in this version, and its default is in English, like the rest of the portal.
- Reminders, goal-setting and plan-making prompts are out of scope on purpose (issue #596).
- Discava has not launched, so the "You're enrolled!" dialog and the tests that expect it are changed outright, with no fallback.
