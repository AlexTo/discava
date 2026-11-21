# Feature Specification: Student Portal UX Fixes

**Feature Branch**: `20261121-133515-student-portal-ux-fixes` (spec only; implementation PRs branch from `main`)

**Created**: 2026-11-21

**Status**: Draft

**Input**: User description: "Student portal UX audit fixes (audit of enrol → first lesson → quiz, and of the discovery pages: home, search, category, instructor profile, sign-in). Fix the audited defects without changing behaviour or API calls, reusing the shared components. Out of scope: new features, search relevance, copy rewrites beyond labels and error messages, brand restyling, the instructor and admin portals. Also record the UI rules these fixes follow where future agents implementing UI will load them."

**Parent issue**: none

## User Scenarios & Testing *(mandatory)*

Two audits walked the student portal as a visitor and as a signed-in student, at a desktop width (1440px) and a phone width (375px), and checked each screen against the Web Interface Guidelines: the flow from a course's page through enrolling, the first lesson and a quiz, and the pages a visitor finds courses with (home, search, category, instructor profile, sign-in). They found defects that stop people using the product on a phone or with a keyboard, links that leave the page they belong to, and errors that say nothing useful. This feature fixes them.

Nothing here is a new feature. Each story restores something the page already claims to do. The stories are independent: any one can ship alone.

Three terms are used throughout:

- **Phone width** is a 375px-wide viewport, and **desktop width** a 1440px-wide one: the two the audits measured.
- **Sideways scroll** means the page is wider than the viewport, so content sits off-screen to the right.
- **Focus is lost** means that after an action the keyboard's position falls back to the top of the document: a keyboard user must tab through the page again, and a screen reader says nothing.

### User Story 1 - A lesson fits the screen (Priority: P1)

A student opens a lesson of a course whose module and lesson titles are long. On a phone the page is as wide as the screen and the lesson is the first thing they see; on a desktop the lesson has the wide column and the outline the narrow one.

**Why this priority**: The lesson page is where a student spends their time, and today it is broken on a phone: the page is 635px wide in a 375px viewport, so quiz options and the Next button are partly off-screen. On a desktop the outline takes 611px and the lesson 445px, the reverse of what is intended.

**Independent Test**: Publish a course whose module and lesson titles are each over 60 characters, enrol, and open its first lesson at both widths.

**Acceptance Scenarios**:

1. **Given** a course with long module and lesson titles, **When** a student opens a lesson at phone width, **Then** the page has no sideways scroll, and the outline's long titles are cut short with an ellipsis.
2. **Given** the same lesson at desktop width, **When** the page loads, **Then** the lesson column is about twice as wide as the outline column.
3. **Given** a lesson at phone width, **When** the page loads, **Then** the course outline is closed behind a "Course outline" control that shows the current lesson's place, and the lesson's title is visible without scrolling.
4. **Given** the closed outline at phone width, **When** the student opens it, **Then** it shows every module and lesson as it does today, the current lesson marked, and choosing a lesson opens that lesson.
5. **Given** a student who has just enrolled on a phone, **When** they land on their first lesson, **Then** the "You're enrolled" notice and the lesson title are both visible without scrolling.

---

### User Story 2 - Links on a page stay on that page (Priority: P1)

A visitor reading a course's page uses its section tabs ("About", "Modules", "Instructors", "Reviews") and the "N modules" card to move around the page. Each takes them to that section of the same page.

**Why this priority**: Today every one of these links sends the visitor to the home page. A person deciding whether to enrol is thrown out of the course page by its own navigation.

**Independent Test**: Open any published course's page, click each section tab and the "N modules" card, and check the address and the scroll position after each.

**Acceptance Scenarios**:

1. **Given** a course's page, **When** a visitor clicks a section tab, **Then** the page scrolls to that section, its heading is visible below the sticky bars, and the address is still the course's page (with the section's name after `#`).
2. **Given** a course's page, **When** a visitor clicks the "N modules" card, **Then** the page scrolls to the modules section.
3. **Given** a section link, **When** a visitor opens it in a new tab or copies it, **Then** the new tab opens the same course page at that section.
4. **Given** a course page with six section tabs at phone width, **When** the tabs are wider than the screen, **Then** the tab bar scrolls sideways by itself and the page does not.
5. **Given** a lesson with several items, **When** a student opens one of its step links in a new tab, **Then** the new tab opens the same lesson at that item.
6. **Given** the signed-out home page, **When** a visitor uses its footer, **Then** every link there goes somewhere other than the footer itself.

---

### User Story 3 - Search works on a phone (Priority: P1)

A signed-in student on a phone taps the search box in the top bar, types, sees what they typed and a readable list of suggestions, and picks one.

**Why this priority**: Search is the main way to find a course. For a signed-in instructor-student on a phone the box is 54px wide and its suggestions do not show at all, and the top bar is 20px wider than the screen so the user menu is cut off. Signed out, the four suggestions all read "UX audit …".

**Independent Test**: At phone width, sign in as a user who is both instructor and student, type three letters in the search box, and pick a suggestion. Repeat signed out.

**Acceptance Scenarios**:

1. **Given** any page at phone width, signed in as an instructor-student, **When** the page loads, **Then** the top bar is no wider than the screen and the user menu is fully visible.
2. **Given** the same user, **When** they type in the search box, **Then** at least 20 characters of what they typed are visible.
3. **Given** suggestions for what was typed, **When** the list opens at phone width, **Then** it is nearly as wide as the screen, and two courses whose titles share their first 20 characters can be told apart.
4. **Given** a phone-width top bar, **When** a signed-in user looks for "My Learning" and, for an instructor, the instructor portal, **Then** both are still reachable in at most two taps.
5. **Given** desktop width, **When** any user loads any page, **Then** the top bar looks and works as it does today.

---

### User Story 4 - Filters do not get in the way (Priority: P2)

A visitor narrows the catalogue with the filter panel on the home page, a search, or a category page. On a phone the courses come first and the filters are one tap away. Changing a filter never makes the panel vanish or the keyboard lose its place.

**Why this priority**: On a phone the first course starts between 924px and 1122px down an 812px screen, below a full screen of checkboxes. On any device, changing a filter removes the whole panel until the results return, and a keyboard user is sent back to the top of the page after every checkbox.

**Independent Test**: With courses that have a category, level, language, duration and tags, open the home page at phone width and count how far down the first course is; then, with a keyboard at desktop width, tick two filters in a row.

**Acceptance Scenarios**:

1. **Given** the home, search or category page at phone width with results, **When** the page loads, **Then** the first course starts within the first screen, and the filters are behind a "Filters" control that shows how many are active.
2. **Given** the filter panel at any width, **When** a visitor changes a filter or the sort order, **Then** the panel stays on screen while the results reload, and the results show that they are reloading.
3. **Given** a keyboard user on a filter checkbox, **When** they toggle it, **Then** focus stays on that checkbox after the results reload.
4. **Given** a filter row, **When** a visitor taps anywhere from the checkbox to the end of its label, **Then** the filter toggles; the row is at least 24px tall.
5. **Given** a category page where a visitor searched for a word, **When** they press Back, **Then** the category's search box shows the text that matches the results on screen.
6. **Given** a search for one very long unbroken word at phone width, **When** the results page loads, **Then** the heading wraps and the page has no sideways scroll.

---

### User Story 5 - A quiz can be taken with a keyboard or a screen reader (Priority: P2)

A student takes a quiz without a mouse. After each step, starting, reviewing, submitting and finishing, the keyboard is where the new content is, and the result is read out.

**Why this priority**: Today focus is lost after Start quiz, Review answers, Submit and Done, and the score is never announced, so a screen-reader user who submits hears nothing. The question navigator is a row of 12px dots with no numbers.

**Independent Test**: Take a three-question quiz with two attempts using only the keyboard, with a screen reader on.

**Acceptance Scenarios**:

1. **Given** a quiz's overview, **When** a student starts it with the keyboard, **Then** focus moves to the first question.
2. **Given** a question, **When** the student moves to the next or previous question, the review, or back to a question from the review, **Then** focus moves to the start of what is now shown.
3. **Given** the review, **When** the student submits, **Then** focus moves to the result and a screen reader announces the score and whether it passed.
4. **Given** a quiz with more than one question, **When** the student looks at the question navigator, **Then** each question is a numbered control at least 24px wide and tall that shows which are answered and which is current.
5. **Given** a quiz with a limit on attempts, **When** the student reaches the review, **Then** the submit control reads "Submit answers" and a line says which attempt this uses, for example "This uses attempt 1 of 2".
6. **Given** a quiz with unlimited attempts, **When** the student reaches the review, **Then** no attempt line is shown.
7. **Given** a result that reveals correct answers, **When** a correct option's text runs to several lines, **Then** its tick is the same size as on a one-line option, and "(your answer)" stays readable.
8. **Given** a submission that fails, **When** the error appears, **Then** it is announced, the student's answers are kept, and they can submit again.

---

### User Story 6 - Errors say what to do next (Priority: P2)

When something fails to load or save, the student sees a sentence written for people that says what happened and what to do, and where it is a load that failed, a way to try again without reloading the page.

**Why this priority**: With the network down, enrolling, loading a lesson, loading a quiz, submitting a quiz and loading the signed-in home all show the browser's "Failed to fetch". A server fault shows "Output validation failed". A failed quiz load is a dead end.

**Independent Test**: Block the portal's requests in the browser, then open a course page and enrol, open a lesson with a quiz, and open the signed-in home.

**Acceptance Scenarios**:

1. **Given** no connection, **When** any request in the student portal fails, **Then** the message says the portal could not be reached and to check the connection and try again; it never shows "Failed to fetch".
2. **Given** a server fault with no message written for people, **When** it is shown, **Then** the message says something went wrong on Discava's side and to try again in a moment; it never shows "Output validation failed" or another internal phrase.
3. **Given** an error the server did write for people (for example "This course must be purchased"), **When** it is shown, **Then** it is shown as written.
4. **Given** a failed load of a course, a lesson, a quiz, the signed-in home's courses or its "Courses to start", **When** the error is shown, **Then** it has a "Try again" control that repeats the same request, and success replaces the error with the content.
5. **Given** a failed enrolment, **When** the error is shown, **Then** the "Enrol now" control is still usable, as today.

---

### User Story 7 - Every page says where you are (Priority: P2)

A student with several tabs open can tell them apart, and a screen-reader user who follows a link hears the new page's name.

**Why this priority**: Every page in the portal is titled "Discava" except the instructor profile, which sets a title that the next page then keeps. Moving between pages leaves focus where it was, so a screen reader says nothing. The signed-out home page has no main heading.

**Independent Test**: Open the home page, a search, a course, a lesson and an instructor profile in turn, reading the tab's title each time, then go back through them.

**Acceptance Scenarios**:

1. **Given** any page of the student portal, **When** it has loaded, **Then** the tab's title names the page and ends with "Discava", for example "Projections · Linear Algebra · Discava" for a lesson.
2. **Given** a page reached from another page, **When** the visitor goes back or on, **Then** the title is the one for the page now shown, never the previous page's.
3. **Given** a page whose content is still loading or failed to load, **When** the title is read, **Then** it names the kind of page ("Course · Discava") or is "Discava", never another page's name.
4. **Given** a keyboard or screen-reader user, **When** they follow a link to another page of the portal, **Then** focus moves to the new page's main heading and its name is announced.
5. **Given** each page of the student portal, **When** its headings are listed, **Then** there is exactly one main heading and no level is skipped.
6. **Given** a visitor sent to sign in, **When** the sign-in page shows before the redirect, **Then** it says "Signing you in…" beside its spinner.

---

### User Story 8 - Course cards and profiles read cleanly (Priority: P3)

A visitor scanning a grid of courses sees cards of a similar, modest height, can click a course's title or picture to open it, and sees an instructor's profile as intended.

**Why this priority**: A course with a long description makes an 807px-tall card, and a 12-course home page is 9,961px tall on a phone. Only the small "Learn more" link opens the course. The instructor profile's picture renders at 40px with 30px initials spilling out of it.

**Independent Test**: Publish a course with a 500-character description and a title of four lines, then view the home page, a search and its instructor's profile.

**Acceptance Scenarios**:

1. **Given** a course with a long description, **When** its card is shown in any grid, **Then** the description is cut to three lines with an ellipsis.
2. **Given** a course title that wraps, **When** its card is shown, **Then** the lines do not touch.
3. **Given** a course card, **When** a visitor clicks its title or its picture, **Then** the course's page opens; the card is still one stop in the keyboard's tab order.
4. **Given** a course card's link, **When** a voice-control user says its visible text, **Then** the link is found: its accessible name contains its visible text.
5. **Given** an instructor's profile, **When** it loads, **Then** the picture or initials fill a 112px circle.
6. **Given** an instructor with no published courses, **When** their profile loads, **Then** the courses section says they have no published courses yet.
7. **Given** a lesson's step links and a student who asked their system for reduced motion, **When** they use a step link, **Then** the page jumps to the item without animation, and focus moves to that item.

---

### User Story 9 - The rules are written down for the next change (Priority: P3)

Whoever next builds or changes a screen in a portal, a person or an agent, finds the rules these fixes follow where they already look, and a way to check a screen against them.

**Why this priority**: The defects above were each introduced by a reasonable change made without these rules to hand. Fixing them once does not stop them coming back.

**Independent Test**: Ask an agent that has not seen this spec to add a filterable list page to a portal, and review what it produces against the rules.

**Acceptance Scenarios**:

1. **Given** an agent starting work in any portal or in the shared UI components, **When** it loads the project's instructions for that folder, **Then** it is given the UI rules without being told to look for them.
2. **Given** the UI rules, **When** they are read, **Then** each of this feature's stories is covered by a rule stated as a check ("a page has no sideways scroll at 375px"), not as advice.
3. **Given** the UI rules, **When** they are read, **Then** they say how to audit a screen (the two widths, the states to check, where screenshots go) and point to the Web Interface Guidelines for everything they do not restate.
4. **Given** the rules and the existing conventions, **When** both are read, **Then** nothing is stated twice and nothing conflicts.

### Edge Cases

- A course with one module and one lesson: the phone-width outline control still appears and names that lesson.
- A lesson the instructor removed: the "removed" message shows as today, with a title that does not name the removed lesson.
- A course page with only the two section tabs every course has ("About", "Modules" and "Reviews" are always present; the others depend on the course): the tab bar does not scroll.
- A quiz with one question: no question navigator is needed; if shown it has one control.
- A quiz whose questions change while the student is answering: they are sent to the review as today, and focus moves there.
- A filter change that returns no courses: the panel stays, so the filter can be undone, and "Clear filters" still shows.
- The first load of a results page, before any results exist: the filter panel cannot show yet, as today; only later changes must keep it.
- A signed-in student who is not an instructor at phone width: the top bar has fewer links; it must still fit and search must still work.
- A title with characters that are not Latin letters, or a very long title, in the tab's title: shown as written; the browser shortens it.
- Text zoomed to 200% at desktop width: the same rules about sideways scroll hold.

## Requirements *(mandatory)*

### Functional Requirements

**Layout at any width**

- **FR-001**: No page of the student portal may scroll sideways at phone width or desktop width, with titles, descriptions, tags and search text of any length the product accepts.
- **FR-002**: On the lesson and course-home pages at desktop width, the lesson column MUST be wider than the outline column whatever the lengths of the titles in the outline.
- **FR-003**: On the lesson page below desktop layout, the course outline MUST start closed behind a control labelled "Course outline" that names the current lesson, and MUST open to the same outline as today.
- **FR-004**: On the home, search and category pages below desktop layout, the filter panel MUST start closed behind a control labelled "Filters" that shows the number of active filters, and the first course MUST start within the first screen at phone width.
- **FR-005**: The top bar MUST fit the screen at phone width for every kind of signed-in user, with the search box showing at least 20 typed characters and the user menu fully visible. "My Learning" and the instructor portal link MUST stay reachable in at most two taps.
- **FR-006**: The search suggestions MUST be visible at phone width, span nearly the screen's width, and show enough of each title to tell apart two titles that share their first 20 characters.
- **FR-007**: A bar of tabs or chips that can be wider than the screen MUST scroll within itself.

**Links and navigation**

- **FR-008**: Every link to a section of the current page MUST lead to that section of that page, when clicked and when opened in a new tab.
- **FR-009**: No link may lead to the element that contains it.
- **FR-010**: Following a link to another page of the portal MUST move focus to the new page's main heading.
- **FR-011**: Every page MUST set the tab's title to its own name followed by "Discava", and MUST replace it when the page changes, including on Back.
- **FR-012**: Every page MUST have exactly one main heading, with no heading level skipped.
- **FR-013**: A lesson's step links MUST honour the system's reduced-motion setting and MUST move focus to the item they lead to.

**Keeping the keyboard's place**

- **FR-014**: Changing a filter or the sort order MUST keep the filter panel on screen and keep focus on the control that was changed.
- **FR-015**: Each change of what the quiz card shows (start, next, back, review, change an answer, submit, done, retake) MUST move focus to the start of the new content.
- **FR-016**: A quiz result and a failed submission MUST be announced to assistive technology when they appear.

**Controls**

- **FR-017**: The quiz's question navigator MUST be numbered controls of at least 24px by 24px that show answered and current questions.
- **FR-018**: A filter's checkbox and label MUST form one target with no dead area between them, at least 24px tall.
- **FR-019**: On a quiz with a limit on attempts, the review MUST label its submit control "Submit answers" and say which attempt of how many it uses.
- **FR-020**: A course card's title and picture MUST open the course, the card MUST be a single stop in the tab order, and its link's accessible name MUST contain its visible text.

**Content of any length**

- **FR-021**: A course card's description MUST be cut to three lines, and its title's wrapped lines MUST not touch.
- **FR-022**: An icon beside text that can wrap MUST keep its size.
- **FR-023**: The category page's search box MUST always show the text of the search whose results are on screen.
- **FR-024**: The instructor profile MUST show the picture or initials in a 112px circle, and MUST say so when the instructor has no published courses.

**Errors and waiting**

- **FR-025**: A failed request MUST be shown as a sentence written for people that includes a next step. The browser's and the server's internal phrases ("Failed to fetch", "Output validation failed" and the like) MUST never be shown. A message the server wrote for people MUST be shown unchanged.
- **FR-026**: A failed load of a course, lesson, quiz, the signed-in home's courses or its "Courses to start" MUST offer "Try again", which repeats the same request.
- **FR-027**: A page that shows only a spinner MUST say in words what is happening.

**What does not change**

- **FR-028**: No request the portal makes, and nothing a request does, may change: the same calls, with the same inputs, at the same moments. "Try again" repeats a call the page already makes.
- **FR-029**: Anything fixed in a component the three portals share MUST be fixed there, so the instructor and admin portals get it too; a new shared component goes with the shared ones. No portal other than the student portal is otherwise changed.
- **FR-030**: Buttons keep text labels only, with no arrow icons, as the project's conventions say.

**Writing the rules down**

- **FR-031**: The project's agent instructions for the portals and the shared UI components MUST carry the UI rules this feature follows, each stated as a check, loaded automatically when an agent works in those folders.
- **FR-032**: Those instructions MUST say how to audit a screen: at phone and desktop width; in its loading, empty, error and long-content states; with the keyboard alone; saving screenshots where the project's conventions say.
- **FR-033**: Those instructions MUST point to the Web Interface Guidelines for rules they do not restate, and MUST NOT repeat or contradict the project's existing conventions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At phone width and desktop width, none of the audited pages (course page, lesson, course home, home signed out and signed in, search, category, instructor profile) is wider than the screen, with titles of 90 characters and a search for a 70-character unbroken word.
- **SC-002**: At phone width, the lesson's title after enrolling, and the first course on the home, search and category pages, start within the first 812px of the page. Today they start at 821px, 1122px, 924px and 940px.
- **SC-003**: At desktop width with 60-character module titles, the lesson column is at least 1.8 times the outline column's width. Today it is 0.73 times.
- **SC-004**: Every section tab and the "N modules" card on a course page leave the visitor on that course page: 0 of them change the page. Today all of them do.
- **SC-005**: At phone width, signed in as an instructor-student, a person can search for a course by typing three letters and choosing a suggestion. Today the suggestions do not show.
- **SC-006**: A quiz can be started, answered, reviewed, submitted and retaken with the keyboard alone, and focus is lost 0 times. Today it is lost four times per attempt.
- **SC-007**: A keyboard user can tick three filters in a row with three key presses and two presses of Tab or the arrow keys between them. Today each needs tabbing from the top of the page.
- **SC-008**: With the network blocked, 0 screens in the audited flows show "Failed to fetch", and every failed load offers "Try again".
- **SC-009**: Every audited page has its own title; no two different pages share one, and none keeps the previous page's.
- **SC-010**: No control a student must use in the audited flows is smaller than 24px in either direction, other than links inside a sentence.
- **SC-011**: In a grid of courses where one course has a 500-character description and the others have one line, the tallest card is at most 1.5 times the height of the shortest. Today it is twice.
- **SC-012**: A reviewer can check any new portal screen against the written UI rules in under 15 minutes, and each rule is a yes-or-no check.

## Assumptions

- The audits' measurements were taken on the local stack with data made for them; the defects do not depend on that data except that long titles make the layout ones visible.
- "Desktop layout" begins where the pages already switch from one column to two; this feature does not move that point.
- Closing the outline and the filters on a phone changes what is shown first, not what can be done: this is within "without changing behaviour", which is about what requests and data do.
- "Try again" and keeping the previous results on screen while new ones load are also within it: both use requests the page already makes.
- The suggestions and the results disagreeing (typing "typ" suggests courses that a search for "typ" does not find) is search behaviour, not presentation. It is out of scope and is recorded as an open question for the search feature's owner.
- The signed-in home's "Courses to start" failing on the local stack is a fault in local data or in the list request, not in the page. This feature only changes how the failure is worded and adds "Try again".
- The dead "Terms" link is removed, not replaced: there is no terms page, and writing one is out of scope.
- The enrolment notice showing again after a reload, the height of the signed-in home's welcome panel, and the faint outline of unselected radio buttons and checkboxes are noted by the audits and left alone: the first two are behaviour and layout taste, and the third is brand styling.
- The instructor and admin portals, the remaining student-portal pages (course home, video, file and assignment items, My Learning, certificates, settings) and the pages served to crawlers have not been audited. They gain only what a shared component gives them.
- Screen-reader announcements are checked by a person with a screen reader before merge; automated tests check focus and the markup that causes the announcement.
- The Web Interface Guidelines are the public guidelines the project's `web-design-guidelines` skill fetches; the written rules link to them and restate only what this project has decided.
