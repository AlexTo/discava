# Feature Specification: Instructor Portal UX Fixes

**Feature Branch**: `20261123-000428-instructor-portal-ux-fixes` (spec only; implementation PRs branch from `main`)

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "Instructor portal UX fixes: fix the defects a UX audit of every instructor-portal page found (2026-11-22, local stack, 375px and 1440px, keyboard, loading/empty/error/long-content states, checked against packages/websites/CLAUDE.md and the Web Interface Guidelines). Pages: sign-in, shell (sidebar, breadcrumbs, user menu), home, dashboard and course analytics, My Courses, the course editor (structure, settings forms, landing page, announcements, archived), the lesson-item dialogs (text, video, file, captions, video questions, quiz builder and preview, assignments), questions, reviews, assignment submissions and grading, earnings, profile, notification settings. Fix them without changing what requests the portal makes, reusing and fixing the shared components where the defect is in shared code. Out of scope: new features (sorting My Courses, next-submission navigation, counts on links, autosave), brand restyling, the admin portal beyond what shared fixes give it. Also extend packages/websites/CLAUDE.md with the rules these fixes add."

**Parent issue**: none

**Audit**: [audit.md](./audit.md) lists the 110 findings (12 P1) by ID. Every story below names the findings it fixes.

## Clarifications

### Session 2026-11-23

Five questions were resolved with the recommended defaults, for the maintainer to confirm in review. Three were put to the maintainer, who chose the recommended answer each time; they are marked "confirmed by the maintainer".

- Q: On a phone, how do a lesson row's controls fit beside a long title (C-01, D-04)? → A: The title takes the row's full width and wraps. The controls go on a line below it, and that line wraps too. Every control stays one tap away. A "more" menu would save a line, but it would hide Edit and Remove behind a second tap and change what the e2e helpers find. At desktop width the row is unchanged (FR-002, US1).
- Q: How is the course editor's long page made quick to use (C-03)? → A: Two changes. "Course content" moves directly below the course's header card, ahead of the settings sections. A row of section links under the header ("Content", "Landing page", "Catalogue", "Captions", "Certificates", "First-lesson prompt", "Price", "Announcements", "Archived", each shown only when its section is on the page) leads to each section, with the section's name in the address after `#`. There are no tabs and nothing collapses: every section stays on one page, as today, so nothing moves out of reach of a search in the page (FR-024, US10).
- Q: Which unsaved work is guarded, and does Cancel ask (C-11, D-06)? → A: The question is asked when a dialog holding typed or uploaded work is dismissed with Escape or a click outside it, and when someone leaves the course editor, in the portal or by closing the tab, with a settings section that has unsaved changes. Cancel is a deliberate choice, so it discards without asking, and it always discards: reopening shows the saved values (FR-018 to FR-020, US6).
- Q: What does a button do while its save is running, given that disabling it loses focus (C-07, A-13)? → A: It keeps focus, says what it is doing ("Saving…"), and ignores further presses until the save finishes. It is never removed from the tab order mid-action (FR-013, US5).
- Q: What should the home page's "Give feedback" button, which does nothing, become (A-08)? → A: It is removed (confirmed by the maintainer). There is no feedback destination in the product, and making one is a feature (US2 scenario 7).
- Q: How far should the course editor's long-page fix go (C-03)? → A: "Course content" first, plus section links kept in the address. Every section stays on one page; no tabs (confirmed by the maintainer, as the default above).
- Q: Is My Courses' 100-course limit (B-23) fixed here? → A: No. It is a separate bug fix, because following the list's cursor adds requests (confirmed by the maintainer).
- Q: Several fixes are in components the three portals share (the dialog frame, breadcrumbs, the route announcer in the shell, discussion post cards, notification settings, switches and checkboxes). Do the student and admin portals change too? → A: Yes, wherever the fix is in shared code. The admin portal gains page focus on navigation and working breadcrumbs from the shared shell. Both portals gain dialogs that fit a phone and larger close buttons and switches. Nothing else in them is touched, and they are not re-audited here (FR-033).

## User Scenarios & Testing *(mandatory)*

The audit walked every page of the instructor portal at a desktop width (1440px) and a phone width (375px), with the keyboard alone, and in each page's loading, empty, error and long-content states. Each screen was checked against the portal UI rules and the Web Interface Guidelines.

It found:

- controls pushed off a phone's screen, so an instructor cannot edit their course there;
- links and breadcrumbs that lead to the home page or to "Not Found";
- focus dropped to the top of the page after dozens of actions;
- typed work thrown away by Cancel, a stray click or a failed save;
- errors that say "Failed to fetch" or offer no way to retry.

This feature fixes them.

Nothing here is a new feature. Each story restores something the page already claims to do. The stories are independent: any one can ship alone.

The student-portal spec ([20261121-133515-student-portal-ux-fixes](../20261121-133515-student-portal-ux-fixes/spec.md)) uses the same terms:

- **Phone width** is a 375px-wide viewport. **Desktop width** is a 1440px-wide one.
- **Sideways scroll** means the page, or an open dialog, is wider than the viewport, so content sits off-screen to the right. **Clipped** means the content is cut off at a card's or dialog's edge and cannot be reached at all.
- **Focus is lost** means that after an action the keyboard's position falls back to the top of the document or of a dialog. A keyboard user must tab through again, and a screen reader says nothing.
- **Long content** means a 90-character title, a 500-character description or question, and a 70-character word with no spaces, all of which the portal accepts.

### User Story 1 - The course editor works on a phone (Priority: P1)

An instructor opens their course on a phone to fix a typo in a lesson title, hide a lesson or check a quiz. Every module's and lesson's controls are on screen, every item says what it is, and every dialog they open fits the screen with its Save button in reach.

**Why this priority**: Today the course editor cannot be used on a phone at all, with titles of ordinary length:

- **Lesson and module rows (C-01):** 67 controls sit beyond the right edge, clipped by the module card.
- **Lesson item rows (D-04):** titles are squeezed to 0px, so a row shows only an icon.
- **Quiz builder (D-02):** Save quiz is off-screen.
- **Video questions dialog (D-01):** one long question makes it 3,804px wide, at any width, with Save 3,909px from the left edge.

**Independent Test**: Make a course with three modules of three lessons whose titles are 60 to 90 characters long, one with a 70-character word. Give a lesson a text, video, file and quiz item and a 12-question quiz whose first question is 500 characters long. Open the editor and each item's dialog at both widths.

**Acceptance Scenarios**:

1. **Given** the course above at phone width, **When** the editor loads, **Then** every module and lesson control (Edit, Remove, Hide or Publish, free preview, the add-item buttons) is fully on screen and can be pressed, and each title wraps in full.
2. **Given** a lesson's items at phone width, **When** the row is shown, **Then** each item's title is readable (at least one full line), beside its kind, with its controls on screen.
3. **Given** the quiz builder or the New assignment dialog with a quiz at phone width, **When** it opens and after any change, **Then** the dialog is no wider than the screen and Save quiz, Preview as student and Close are on screen.
4. **Given** the video-questions or quiz-builder dialog with a collapsed 500-character question, **When** it opens at either width, **Then** the dialog is no wider than the screen and its Save is visible.
5. **Given** the text, file or captions dialog with a 70-character word in the body, file name or title at phone width, **When** it opens, **Then** the dialog has no sideways scroll and the word wraps.
6. **Given** archived lessons and modules at phone width, **When** the archived section shows, **Then** each title is readable on its own line and the Restore and Delete controls sit below it.
7. **Given** an announcement whose title has a 70-character word at phone width, **When** it is posted, **Then** the page has no sideways scroll.
8. **Given** the maths popover at phone width, **When** it opens, **Then** it fits the screen and Insert is fully visible.
9. **Given** desktop width, **When** any of the above is shown, **Then** it looks and works as it does today, apart from the long-content fixes.

---

### User Story 2 - Links and breadcrumbs lead somewhere real (Priority: P1)

An instructor uses the breadcrumb trail to step back up from a submission to its assignment and course. They use the landing-page checklist's "Add it" links to jump to what is missing. Every link takes them to a real page or section, named in words.

**Why this priority**: Every one of these links lands somewhere broken:

- **Checklist "Add it" links (C-02):** each sends the instructor to the portal's home page.
- **Breadcrumbs (A-05, E-04):**
  - "Settings" and "Assignments" lead to a bare "Not Found" page with no way back.
  - The course and assignment crumbs show raw IDs ("01a20344-3a71-…").
  - The first crumb is a 4px-wide "/" (A-04).
- **Home page (A-08):** "Give feedback" does nothing.

**Independent Test**: Open the notification settings, an assignment's submissions, a submission, the earnings page and a draft course's landing-page checklist. Use every breadcrumb and every "Add it" link, and open each in a new tab.

**Acceptance Scenarios**:

1. **Given** any page, **When** its breadcrumb trail is shown, **Then** the first crumb reads "Home", every crumb is a word or a title (never an ID or a lower-case path segment), and every crumb that is a link opens a page that exists.
2. **Given** a path segment with no page of its own (such as "Settings" or "Assignments"), **When** the trail is shown, **Then** that crumb is plain text, not a link.
3. **Given** a submission's review page, **When** its trail is shown, **Then** it names the course, the assignment and the student, and the assignment crumb opens the submissions list.
4. **Given** the landing-page checklist, **When** the instructor uses an "Add it" link, **Then** the page scrolls to that section of the same course page, the address is still the course page (with the section's name after `#`), and each link's name says what it adds ("Add it: Preview video").
5. **Given** the checklist's profile line, **When** it is used, **Then** the profile page opens within the portal, without reloading the app.
6. **Given** an address in the portal that matches no page, **When** it is opened, **Then** a "Page not found" page shows inside the portal's shell, with its navigation and a link home.
7. **Given** the home page, **When** it loads, **Then** every control on it does something, and the "Give feedback" card is gone.

---

### User Story 3 - Every page fits a phone, whatever the content (Priority: P1)

An instructor checks their analytics, reads a student's question, grades a submission or answers a review on a phone. Each page is as wide as the screen, and long titles, names and words wrap instead of pushing the page sideways.

**Why this priority**: Five pages scroll sideways on a phone today:

- **Course analytics (B-01):** 673px wide for any course with students.
- **Submission review (E-02):** 586px wide, with the student's file preview fixed at 560px.
- **Reviews (E-03):** 515px wide.
- **Question thread dialog (E-01):** 589px of content in a 341px dialog, so the reply box is cut off.
- **Dashboard (B-02):** 667px wide when a title holds a long word.

Course cards also hide their status badges (A-09, B-10).

**Independent Test**: With a course that has students, quiz attempts, a 90-character title with a 70-character word, 500-character questions, reviews and feedback, and a student with a 40-character name, open at phone width: the dashboard, the course's analytics, My Courses, home, the questions page and a thread, reviews, the submissions list and a submission, and earnings.

**Acceptance Scenarios**:

1. **Given** any page above at phone width with long content, **When** it loads, **Then** it has no sideways scroll, and no dialog it opens has any.
2. **Given** course analytics at phone width, **When** a lesson title is longer than its column, **Then** it is cut short with an ellipsis, its full text can be read without hovering, and each lesson's started and completed counts are visible without hovering.
3. **Given** the quiz score chart at phone width, **When** it is drawn, **Then** no two axis labels overlap.
4. **Given** the most-missed questions table at either width, **When** a question has a long word, **Then** the "Misses" and "Miss rate" columns are visible without scrolling the table at desktop width.
5. **Given** a course card on home, the dashboard or My Courses, **When** its title has a long word or its description is 500 characters, **Then** the title wraps, the description is cut to three lines, and the status badge stays fully on the card.
6. **Given** a submission's review page at phone width, **When** its file is a PDF, **Then** the preview fits the screen's width.
7. **Given** the earnings tables at phone width, **When** they hold data, **Then** column headers and values are separated by space, dates and amounts each stay on one line, and a table wider than the screen scrolls within itself.

---

### User Story 4 - Every page says where you are and what it is waiting for (Priority: P2)

An instructor with several portal tabs open can tell them apart. A screen-reader user who follows a link hears the new page's name. A page that is loading or failed still has its heading and says in words what it is doing.

**Why this priority**:

- **Tab titles (A-01):** every page is titled "Discava".
- **Focus after following a link (A-02):** it stays on the link that was used, so a screen reader announces nothing.
- **Missing main headings (B-05, C-04, E-14, A-12):** pages that are loading or failed have none.
- **Skipped heading levels (C-16, A-19, E-13).**
- **Two main landmarks:** ten pages have them (A-23).
- **Sign-in (A-07):** a blank page with a spinner and no words.

**Independent Test**: Open each route of the portal in turn, read the tab's title, list the headings and landmarks, then follow links with the keyboard. Repeat with each page's requests delayed, then failing.

**Acceptance Scenarios**:

1. **Given** any page of the instructor portal, **When** it has loaded, **Then** the tab's title names the page and ends with "Discava", for example "Questions · Linear Algebra · Discava".
2. **Given** a page that is loading or failed to load, **When** its title is read, **Then** it names the kind of page ("Course · Discava"), never another page's name.
3. **Given** a keyboard or screen-reader user, **When** they follow a link to another page of the portal, **Then** focus moves to the new page's main heading and its name is announced.
4. **Given** each page, in its loaded, loading, empty and error states, **When** its headings are listed, **Then** there is exactly one main heading, no level is skipped, and there is one main landmark.
5. **Given** a page or section whose whole content is waiting on a request, **When** it shows, **Then** it says in words what it is loading ("Loading the course…", "Signing you in…"), and the waiting region is marked busy.

---

### User Story 5 - The keyboard keeps its place (Priority: P2)

An instructor builds a course, grades and moderates with the keyboard. After every action (save, delete, restore, reorder, post, close a dialog, choose a period) focus is on the control they used, or on what took its place, and the result is announced.

**Why this priority**: The audit counted more than 40 actions that leave focus on the top of the page or the dialog, including:

- every settings Save on the course editor (C-07);
- delete, restore, free preview, tags and announcements (C-08);
- removing or reordering quiz questions (D-09, D-10);
- Save on the profile (A-13);
- grading, reply and moderation actions (E-05 to E-09);
- the phone sidebar (A-03).

Few of them announce what happened.

**Independent Test**: With the keyboard alone, and with a screen reader on, do each action in the list below and note where focus is afterwards and what is announced.

**Acceptance Scenarios**:

1. **Given** a button whose action takes time (any Save, Publish, Return, Post reply), **When** it is pressed, **Then** it keeps focus, says what it is doing, ignores further presses until done, and focus is still on it afterwards, whether the action succeeded or failed.
2. **Given** an action that removes its own control (delete, archive, restore, dismiss a report, remove a tag, remove a question, the last Load more), **When** it completes, **Then** focus moves to the neighbouring item, or to the list's heading when none is left.
3. **Given** an action that swaps one view for another (free preview on or off, Edit and Cancel on an announcement or a grade, Custom range on the earnings period, returning a submission), **When** it completes, **Then** focus moves to the start of the new view or to the control that now does the reverse.
4. **Given** a dialog closed by any means (Close, Escape, Save, a confirmation's Keep editing), **When** it closes, **Then** focus returns to the control that opened it, or to the next sensible control if that one is gone.
5. **Given** a keyboard reorder of lessons, modules or quiz questions, **When** an item is moved, **Then** the announcement names the item by title and its new position ("Question 3 moved to position 2 of 12"), and focus stays on its handle, whether the move was saved or failed.
6. **Given** the phone sidebar, **When** a page is chosen in it, **Then** it closes and focus moves to the new page's main heading; **When** it is closed with Escape, **Then** focus returns to the button that opened it.
7. **Given** an action whose result the instructor waits for (a reply posted, a grade returned, a caption uploaded, settings saved, an announcement posted), **When** it completes, **Then** a short sentence says so and is announced once.
8. **Given** a live count or clock (a character counter, the video's current time), **When** it changes, **Then** it is not announced on every change.

---

### User Story 6 - Typed work is never lost by accident (Priority: P2)

An instructor writes a lesson, a first-lesson prompt or a quiz, uploads a video, or sets a price. Work is lost only when they choose to discard it.

**Why this priority**: Work is lost in several ways today:

- **A failed save (C-09):** it resets the prompt and price fields, throwing away what was typed.
- **Cancel (C-10, B-11):** it keeps unsaved text, which a later Save then writes.
- **A click outside or Escape (C-11, D-06):** it throws away a dialog's typed text, or an uploaded video.
- **Leaving the course editor (C-11):** it silently drops unsaved settings.

**Independent Test**: Type into each dialog and each course settings section. Then, in turn: press Escape, click outside, press Cancel and reopen, make the save fail, and navigate away.

**Acceptance Scenarios**:

1. **Given** a save that fails, **When** the error shows, **Then** every field still holds what the instructor typed, and saving again sends that.
2. **Given** a dialog with changes, **When** the instructor presses Cancel and reopens it, **Then** it shows the saved values.
3. **Given** a dialog holding typed or uploaded work, **When** the instructor presses Escape or clicks outside it, **Then** they are asked whether to discard the changes, and choosing to keep editing returns them to the dialog with focus where it was.
4. **Given** a dialog with no changes, **When** it is dismissed by any means, **Then** it closes without asking.
5. **Given** a course settings section with unsaved changes, **When** the instructor follows a link elsewhere in the portal or closes the tab, **Then** they are asked whether to leave.
6. **Given** the New assignment dialog with a quiz in progress, **When** the instructor switches the kind to Upload, or dismisses the dialog, **Then** they are asked before the quiz is discarded.

---

### User Story 7 - Errors and blocked actions say what to do next (Priority: P2)

When something fails to load or save, or an action can't be taken, the instructor sees a sentence that says what happened and what to do. A failed load can be retried in place.

**Why this priority**: The audit found four ways errors and blocked actions leave the instructor without a next step.

- **Raw browser messages:** "Failed to fetch" appears when a quiz, video questions, reorder or notification setting fails to save (D-07, C-06, A-15).
- **No way to retry:**
  - Eight failed loads have no Try again (B-07, C-04, A-10, D-18, D-15, E-14, A-15).
  - Others offer a hand-made "Retry" beside the message, or a Try again that reloads half the page (E-15).
- **Silent failures:**
  - A wrong file type is silently ignored (D-12).
  - A failed caption removal hides its error behind the confirmation (D-13).
  - A failed profile or category load shows "Checking…" forever, or an empty list (C-20).
- **Blocked actions with no reason:**
  - Save is disabled with no reason (D-22, A-14).
  - Validation errors aren't tied to their fields (D-11, E-16).
  - A draft course offers an announcement form the server refuses (C-12).
  - A failed video gives its reason only in a tooltip (D-05).
  - A new instructor's My Courses says "No courses found – try another filter" (B-08).

**Independent Test**: Block the portal's requests in the browser and open each page and dialog, then save in each. Submit each form empty. Choose a wrong file type. Open My Courses as a new instructor and an announcement form on a draft course.

**Acceptance Scenarios**:

1. **Given** no connection, **When** any request in the instructor portal fails, including a file upload, **Then** the message says the portal could not be reached and to check the connection and try again. It never shows "Failed to fetch" or another internal phrase.
2. **Given** a failed load of any page, section, list or dialog content, **When** the error shows, **Then** it is shown once, with one "Try again" that repeats every request the failure covers, and success replaces it with the content.
3. **Given** a form submitted with problems, **When** it is checked, **Then** each problem is shown next to its field and tied to it, and focus moves to the first field with a problem. Save is never disabled just because a field is incomplete.
4. **Given** a confirmation dialog whose action fails, **When** the error appears, **Then** it appears inside that dialog and is announced.
5. **Given** a file of a type the dialog does not take, **When** it is chosen or dropped, **Then** a message says which types are taken.
6. **Given** a video whose processing is under way or failed, **When** its row shows, **Then** it says "Processing…" or "Processing failed" in words, visible without hovering.
7. **Given** a draft course, **When** the announcements section shows, **Then** it says announcements can be posted once the course is published, instead of a form.
8. **Given** an instructor with no courses, **When** My Courses loads, **Then** it says they have no courses yet and offers Create course. "No courses found" is kept for when a filter hides every course.
9. **Given** a control that can't be used right now (such as Delete permanently on a course with students), **When** it is shown, **Then** the reason is in visible text beside it, not only in a tooltip.

---

### User Story 8 - Lists and views can be shared and come back to (Priority: P3)

An instructor filters My Courses to drafts, opens the Reported tab of a course's questions, or picks last September's earnings. They reload the page, press Back, or send the link to a co-instructor, and the same view opens.

**Why this priority**: The My Courses status filter and search (B-09), the questions page's tab and lesson (E-10), and the earnings period (A-21) are all lost on reload and Back, and can't be linked to.

**Independent Test**: On each of the three pages, choose a view, reload, press Back and Forward, and open the address in a new tab.

**Acceptance Scenarios**:

1. **Given** My Courses with a status filter and search text, **When** the page is reloaded or the address is opened elsewhere, **Then** the same filter and search are applied and shown.
2. **Given** the questions page on the Reported tab, or By lesson with a lesson chosen, **When** the page is reloaded, **Then** the same tab and lesson show.
3. **Given** earnings for a chosen month or custom range, **When** the page is reloaded, **Then** the same period shows.
4. **Given** any of these views, **When** the instructor presses Back, **Then** the previous view shows, and the controls on screen match it.

---

### User Story 9 - Controls are big enough and say what they are (Priority: P3)

An instructor using a touch screen, a voice-control tool or a screen reader can hit every control and knows what each does.

**Why this priority**: Several controls are hard to hit or poorly named:

- **Too small:**
  - Dialog close buttons are 16×16px (B-17).
  - Switches are 36×20px (A-16, C-15).
  - Quiz option checkboxes are 16×16px with a gap before their labels (D-19).
  - Several links are 20px tall (A-18, C-15).
- **Unhelpful names:**
  - Nine "Open course" links share one name (B-21).
  - Module buttons are named by position, so the name points at a different module after a reorder (C-19).
  - Some names don't contain the visible text (D-20).
  - A whole dashboard card is one link named by all of its text (B-20).
- **Busy buttons give no sign** while saving (E-18, A-24).

**Independent Test**: Measure every control on the editor, the dialogs, earnings and notification settings. List each link's and button's accessible name.

**Acceptance Scenarios**:

1. **Given** any control an instructor must use, **When** it is measured, **Then** it is at least 24px by 24px, other than links inside a sentence. A checkbox, radio or switch and its text are one target.
2. **Given** a set of links or buttons with the same visible text, **When** their names are listed, **Then** each is told apart by its course, lesson, module or item title.
3. **Given** any link or button, **When** a voice-control user says its visible text, **Then** it is found: its accessible name contains its visible text.
4. **Given** a dashboard course card, **When** a screen reader reaches its link, **Then** the link is named by the course's title, and the whole card still opens the course.
5. **Given** a dialog, **When** it opens, **Then** it has a title and a description, and focus starts on its first field or least destructive control.
6. **Given** a button whose action is running, **When** it is shown, **Then** its label says so ("Returning…", "Opening Stripe…").

---

### User Story 10 - The course editor's content is quick to reach (Priority: P3)

An instructor opens their course to work on its lessons. The lessons are the first thing below the course's header. Each settings section is one step away, from a row of section links.

**Why this priority**: Today the course editor of a 30-lesson course is 20,337px tall on a phone. "Course content", the part instructors use most, starts 5,892px down, after five settings sections, and there is no way to jump between sections (C-03). At desktop width it starts 2,980px down.

**Independent Test**: Open the editor of the 6-module course from the audit at both widths, find the first lesson, then reach each settings section.

**Acceptance Scenarios**:

1. **Given** the course editor at either width, **When** it loads, **Then** the "Course content" heading is within the first screen below the course's header card.
2. **Given** the editor, **When** the instructor uses a section link, **Then** the page scrolls to that section, its heading is visible, focus moves to it, and the address names the section after `#`.
3. **Given** a section's address opened in a new tab, **When** it loads, **Then** the editor opens at that section.
4. **Given** the section links at phone width, **When** they are wider than the screen, **Then** the row scrolls within itself and the page does not.
5. **Given** a section that does not apply to this course (no archived items, an archived course), **When** the links show, **Then** there is no link to a section that is not on the page.

---

### User Story 11 - The rules are written down for the next change (Priority: P3)

Whoever next builds a form, a dialog or a row of controls in a portal finds the rules these fixes follow already written in the UI rules, as yes-or-no checks.

**Why this priority**: Most of these defects come from patterns the current UI rules do not mention:

- a disabled button losing focus;
- Cancel that doesn't reset;
- a dialog whose content can't shrink;
- a row of controls that can't wrap;
- a breadcrumb that links to nothing;
- a status region that speaks too often.

Fixing them once does not stop them coming back.

**Independent Test**: Ask an agent that has not seen this spec to add an edit dialog with a Save button and a row with four controls beside a title. Review what it produces against the rules.

**Acceptance Scenarios**:

1. **Given** the UI rules, **When** they are read, **Then** each pattern this feature fixes is covered by a check, and nothing in them conflicts with the existing rules or the root conventions.
2. **Given** the end-to-end tests, **When** an instructor page in this audit scrolls sideways at phone width, or an open dialog is wider than the screen, **Then** a test fails.

### Edge Cases

- **A lesson with no items:** the phone layout shows the add-item buttons on their own line, and nothing is clipped.
- **A course with one module and one lesson:** the section links and reordering still work. A Move up or Move down control that can't move is disabled and skipped by Tab, and after a move focus goes to the control that can still move.
- **A dialog opened from a state with no trigger** (Preview as student, Keep editing): on close, focus returns to the control that was focused before it opened.
- **A save conflict ("changed since you opened it"):** the instructor's input is kept, as for any failed save, and the existing conflict message shows unchanged.
- **An archived course:** read-only, as today. The section links leave out sections that aren't shown, and no unsaved-changes question is asked, since nothing can be edited.
- **A failed load whose server answer is "not found":** it says the course, submission or page is not found and links back to the list; Try again is not offered.
- **A submission whose file can't be previewed:** "This file can't be previewed" and Download, as today, and the page still fits a phone.
- **Text zoomed to 200% at desktop width:** the rules about sideways scroll still hold.
- **A title in a non-Latin script, or very long, in the tab's title:** shown as written; the browser shortens it.
- **Unsaved changes when the session expires and the portal redirects to sign in:** the leave question is not asked. A redirect is not the instructor's choice, and the browser's own question would block it.

## Requirements *(mandatory)*

### Functional Requirements

**Layout at any width**

- **FR-001**: No page of the instructor portal, and no dialog or popover it opens, may scroll sideways or clip content at phone width or desktop width, with titles, names, descriptions, questions, file names and words of any length the product accepts.
- **FR-002**: At phone width, a row that holds a title and several controls (module headers, lesson rows, lesson item rows, archived rows) MUST show the title across the row's full width and put the controls on a line below it, wrapping as needed, so every control is on screen.
- **FR-003**: A dialog's footer of actions MUST wrap at phone width, so that its primary action is always on screen.
- **FR-004**: A title or name cut short with an ellipsis MUST be readable in full without hovering.
- **FR-005**: Information MUST NOT be shown only on hover (for example lesson drop-off counts).
- **FR-006**: A course card's description MUST be cut to three lines, its title MUST wrap, and its status badge MUST stay fully on the card.
- **FR-007**: A chart's axis labels MUST NOT overlap at any width. A table's columns MUST be visibly separated, and a table wider than its container MUST scroll within itself.

**Links and navigation**

- **FR-008**: Every link to a section of the current page MUST lead to that section of that page, when clicked and when opened in a new tab. Links to other portal pages MUST stay within the app, without reloading it.
- **FR-009**: The breadcrumb trail MUST start with "Home" and name every crumb in words or by title. It MUST make a crumb a link only when its page exists.
- **FR-010**: An address that matches no page MUST show a "Page not found" page inside the portal's shell, with a link home.
- **FR-011**: No control may do nothing when used.

**Where you are**

- **FR-012**: Every page MUST:
  - set the tab's title to its own name, then its parent's, then "Discava", separated by " · ";
  - have exactly one main heading in every state, with no skipped levels;
  - have one main landmark.

  Following a link MUST move focus to the new page's main heading.

**Keeping the keyboard's place**

- **FR-013**: A control whose action is running MUST keep focus, say that it is running, and ignore repeated presses. It MUST NOT leave the tab order while it runs.
- **FR-014**: After an action that removes, swaps or hides its own control, focus MUST move to the neighbouring item, the new view's start, or the control that does the reverse. It MUST never be left at the top of the document or dialog.
- **FR-015**: Closing any dialog, sheet or popover MUST return focus to the control that opened it, or to the control focused before it opened. Choosing a page in the phone sidebar MUST close it.
- **FR-016**: A keyboard reorder MUST keep focus on the moved item's handle, and MUST announce the item by title and its new position.
- **FR-017**: The result of a save, post, upload, return or moderation action MUST be announced once. A counter or clock MUST NOT be announced on every change.

**Keeping typed work**

- **FR-018**: A failed save MUST keep everything the instructor entered.
- **FR-019**: Cancel MUST discard a dialog's changes, so that reopening it shows the saved values. Escape or a click outside a dialog with typed or uploaded changes MUST ask before discarding them.
- **FR-020**: Leaving the course editor with unsaved changes in a settings section MUST ask first. This covers following a link in the portal and closing or reloading the tab.

**Errors and waiting**

- **FR-021**: A failed request, including a file upload, MUST be shown as a sentence written for people that includes a next step. The browser's and server's internal phrases MUST never be shown.
- **FR-022**: A failed load MUST be shown once, with one "Try again" that repeats every request the failure covers. Every other failure MUST be shown where the instructor is looking: inside an open confirmation, next to the field it concerns, or beside the control that was used.
- **FR-023**: Each of these MUST be stated in visible text:
  - a form's problems, next to the fields they concern;
  - a wrong file type;
  - a video's processing state;
  - why a control can't be used;
  - why a section is not available (announcements on a draft course).

  The first field with a problem MUST receive focus on submit, and a Save button MUST NOT be disabled to signal an incomplete form.
- **FR-024**: The course editor MUST show "Course content" directly below the course's header card. It MUST offer section links to each section on the page, kept in the address.
- **FR-025**: A page or section waiting on a request MUST say in words what it is waiting for. A busy button's label MUST say what it is doing.
- **FR-026**: An empty list MUST say why it is empty: no items yet (with the action that adds one), or a filter that hides everything (with a way to clear it).

**State in the address**

- **FR-027**: These views MUST live in the address, so that reload, Back, Forward and a shared link restore them, and the controls on screen MUST match the address:
  - My Courses' status filter and search;
  - the questions page's tab and chosen lesson;
  - the earnings period.

**Controls**

- **FR-028**: Every control an instructor must use MUST be at least 24px by 24px, other than links inside a sentence. A checkbox, radio or switch MUST form one target with its text.
- **FR-029**: A link's or button's accessible name MUST contain its visible text. Controls with the same visible text MUST be told apart by what they act on, named by title, never by position.
- **FR-030**: A dialog MUST have a title and a description, and MUST open with focus on its first field or least destructive control.

**What does not change**

- **FR-031**: No request the portal makes, and nothing a request does, may change. The same calls are made, with the same inputs, at the same moments. "Try again" repeats calls the page already makes. Reading a view from the address sends the same inputs the on-screen control sends today.
- **FR-032**: Buttons keep text labels only, with no arrow icons, as the project's conventions say.
- **FR-033**: Anything fixed in a component the three portals share MUST be fixed there, so that the student and admin portals get it too. No portal other than the instructor portal is otherwise changed.

**Writing the rules down**

- **FR-034**: The portals' UI rules MUST gain a check for each pattern this feature fixes that they don't yet cover, without repeating or contradicting the existing rules.
- **FR-035**: The end-to-end tests MUST fail if an audited instructor page scrolls sideways at phone width, if the editor's lesson controls are off-screen at phone width, or if an open quiz-builder or video-questions dialog is wider than the screen.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At phone width, with long content, 0 audited instructor pages or dialogs are wider than the screen. Today 9 are: course analytics 673px, dashboard 667px, submission review 586px, reviews 515px, the thread dialog 589px, the quiz builder 487px, Edit file 579px, Edit text 552px, video questions 3,804px.
- **SC-002**: At phone width, 0 controls on the course editor sit outside the screen or are clipped. Today 67 do.
- **SC-003**: An instructor can rename a lesson, hide it, and save a quiz edit on a phone, start to finish, without zooming or scrolling sideways. Today none of the three can be done.
- **SC-004**: 0 links or breadcrumbs in the portal lead to the home page by mistake, to "Not Found", or show an ID. Today 3 checklist links, every "Settings" and "Assignments" crumb, and every course and item crumb do.
- **SC-005**: With the keyboard alone, focus is lost 0 times across the actions listed in User Story 5. Today it is lost more than 40 times.
- **SC-006**: Typed work is lost 0 times across the six cases in User Story 6. Today it is lost in all six.
- **SC-007**: With the network blocked, 0 screens show "Failed to fetch". Every failed load offers one Try again, and each Try again recovers its whole section.
- **SC-008**: Every instructor page has its own tab title and exactly one main heading in each of its states, and no two different pages share a title. Today every page is titled "Discava", and 7 page states have no heading: sign-in, profile loading, profile error, course analytics error, course analytics not found, course editor error, submission error.
- **SC-009**: At phone width the course editor's "Course content" heading starts within the first 812px below the header card. Today it starts 5,892px down.
- **SC-010**: No control an instructor must use is smaller than 24px in either direction, other than links inside a sentence.
- **SC-011**: Reloading My Courses, the questions page and earnings keeps the view chosen in each. Today all three reset.
- **SC-012**: A reviewer can check a new form, dialog or control row against the written UI rules in under 15 minutes, and each rule is a yes-or-no check.

## Assumptions

- **Audit data.** The measurements were taken on the local stack with data made for the audit. The layout defects depend on that data only in that long titles and words make them visible. Earnings answers were stubbed in the browser, so the earnings figures themselves were not checked.
- **What "without changing behaviour" covers.** Moving "Course content" up, adding section links, keeping a view in the address, asking before discarding, and keeping input after a failed save all change what is shown and when, not what is requested. That is within "without changing behaviour", which concerns requests and data. Reading a view from the address sends the same inputs the on-screen control sends today.
- **Out of scope: the 100-course limit (B-23).** My Courses loads only the first 100 courses. Fixing that means following the list's cursor, which is a new request. It is left for a fix of its own, as the maintainer confirmed, and recorded in [audit.md](./audit.md).
- **Out of scope: the improvements in [audit.md](./audit.md).** Sorting, next-submission navigation, counts on links, one save or autosave, collapsible modules, a shared upload drop zone and full-screen phone dialogs are new features. They are recorded for later.
- **"Give feedback" (A-08).** The card is removed, as the maintainer confirmed. There is no feedback destination in the product today, and making one is a feature.
- **The admin portal.** It is not audited. It gains only what the shared fixes give it (FR-033). An admin-portal reviews screen like the instructor one probably shares E-03, and is noted for its own audit.
- **Not checked.** Screen-reader announcements are checked by a person with a screen reader before merge; automated tests check focus and the markup that causes the announcement. Touch dragging on a real phone, dark mode and the deployed Cognito sign-in were not checked by the audit and are not changed here.
- **The Web Interface Guidelines** are the public guidelines the project's `web-design-guidelines` skill fetches. The UI rules link to them and restate only what this project has decided.
- **Final walk, 2026-11-24 (found after the phases merged; the next audit starts from it).** The walk ran on the local stack at `main` `71769cc`, with scripted Playwright at 375×812 and 1440×900 and touch emulation. It did not cover a real phone, a real screen reader, dismissing a report (no reported post in the data) or real browser text zoom (the root font size was doubled instead). Most checks passed. Items 1 to 6 are **unmet requirements of this spec, not out of scope**: they fail its acceptance scenarios or FR-031 on `main` and need a fix or a follow-up issue of their own (none is linked yet; the maintainer decides). Only item 7 and the emulated text-zoom finding were left out of scope.
  - **Unmet: submission breadcrumb (US2 acceptance 3).** The course crumb reads "Course", not the course title. The assignment crumb is not a link, and a separate "Submissions" crumb opens the list.
  - **Unmet: crumbs with no title (US2 acceptance 1, "never an ID").** When the title cannot load, the course analytics, the editor and the submission show raw IDs in the breadcrumb. The `h1`s, the single `main` and the error messages are right.
  - **Unmet: focus drops to `<body>` (US5, US6.3)** after "Save prompt" by keyboard (the button disables itself after saving), after "Keep editing" in "Discard unsaved changes?" (it should return to the New lesson title field), and after choosing a page in the phone sidebar.
  - **Unmet: quiz builder targets are 16×16px (US9.1):** the "Option N is correct" radios and the "Unlimited" and "Shuffle the options" checkboxes.
  - **Unmet, to be confirmed (SC-003, T088): 200% text zoom at 1440px.** The editor scrolls sideways (page 1952px wide) because the shell header, the breadcrumb and the course `h1` do not wrap. This is emulated, so confirm with a browser's text-only zoom. 200% page zoom passes for the editor and the quiz dialog.
  - **Unmet, a regression of FR-031 ("no request may change"): duplicate request.** The course editor requests `course.captionLanguages` twice (the route and `course-caption-languages-form`); before #892 it was requested once. Seen in one capture.
  - **Out of scope: earnings loading state.** While earnings loads slowly, each card (Payout account, Balance, Payouts) says only "Loading…" under its own heading.
