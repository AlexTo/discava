# Feature Specification: Admin Portal UX Fixes

**Feature Branch**: `20261123-081203-admin-portal-ux-fixes` (spec only; implementation PRs branch from `main`)

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "We have done the student portal UX fixes. Sweep the admin portal and use the web design guidelines to do the same: audit every admin-portal page (local stack, 375px and 1440px, keyboard, loading/empty/error/long-content states, checked against packages/websites/CLAUDE.md and the Web Interface Guidelines), and fix what it finds. Pages: sign-in, shell (sidebar, breadcrumbs, user menu), home, categories, reviews, certificates, payments, branding, notification settings, the restricted page for non-admins and the not-found page. Fix them without changing what requests the portal makes, reusing the shared components and the shared fixes the instructor-portal UX spec already plans. Out of scope: new features (review course search, unarchiving categories, home-page figures that need new requests), brand restyling. Also extend packages/websites/CLAUDE.md and the e2e suite so the admin portal is held to the same rules."

**Parent issue**: none

**Audit**: [audit.md](./audit.md) lists the 56 findings (3 P1) by ID. Every story below names the findings it fixes.

**Builds on**: the [instructor-portal UX fixes](../20261123-000428-instructor-portal-ux-fixes/spec.md), whose Phase 1 and US1 are merged (#892). Its later stories fix several shared components the admin portal uses. This feature names those findings, checks the fixes in the admin portal, and does not make them twice.

## Clarifications

### Session 2026-11-23

These were resolved with the recommended defaults, for the maintainer to confirm in review.

- Q: How does the categories table fit a phone (B-01), given that every row holds Rename and Archive? → A: Below 640px each row stacks: the name across the full width, then its slug, then its status and course count, then Rename and Archive on a line that wraps. This is the order of the table's columns, so a screen reader reads a stacked row as it reads a row today. At desktop width the table is unchanged. A table that scrolls sideways inside itself would keep the actions off-screen, one scroll away, on every row. The read-only Recent changes table on Payments is different: it scrolls within itself (E-01), as the instructor portal's earnings tables do (FR-001, FR-002).
- Q: Should the home page list the areas it leaves out today (A-08)? → A: Yes. Home gains Certificates, Payments and Branding cards, in sidebar order, so that every area of the portal can be reached from it. They carry no figure: one would need a request the portal doesn't make today (FR-028). "Branding" stays in the user menu as well; the sidebar is unchanged (FR-006).
- Q: Which views go in the address (C-07, D-06)? → A: The chosen course on Reviews (`?course=`) and the looked-up certificate on Certificates (`?id=`). Opening either address makes the request the screen makes today when the course is chosen or the ID looked up. The categories list and payments have no view to keep (FR-024).
- Q: Several findings (A-02 to A-05, C-09, F-01, F-02, F-04, F-08) are in shared code that the instructor-portal UX spec already fixes in later stories. Does this feature fix them? → A: No. The instructor tasks fix them once, for every portal. This feature's tasks that rely on them say which instructor task they wait for, and add the admin-portal checks (tests and e2e cases) once it has merged (FR-030).
- Q: The Reviews and Certificates dialogs ask for a reason or a note. Does Cancel ask before discarding one? → A: No, as in the instructor portal. Cancel is a deliberate choice and always discards. Escape or a click outside asks first when something was typed (FR-017).

## User Scenarios & Testing *(mandatory)*

The audit walked every page of the admin portal at a desktop width (1440px) and a phone width (375px), with the keyboard alone, and in each page's loading, error and long-content states. Each screen was checked against the portal UI rules and the Web Interface Guidelines.

It found:

- three pages that can't be used on a phone, with their actions off-screen;
- breadcrumbs and addresses that lead to a bare "Not Found";
- focus dropped to the top of the page after almost every action;
- buttons disabled with no reason, and errors that sit far from what they concern;
- views that a reload throws away.

This feature fixes them.

Nothing here is a new feature. Each story restores something the page already claims to do. The stories are independent: any one can ship alone.

The terms are those of the student and instructor portal specs:

- **Phone width** is a 375px-wide viewport. **Desktop width** is a 1440px-wide one.
- **Sideways scroll** means the page, or an open dialog, is wider than the viewport, so content sits off-screen to the right.
- **Focus is lost** means that after an action the keyboard's position falls back to the top of the document or of a dialog. A keyboard user must tab through again, and a screen reader says nothing.
- **Long content** means a 90-character title, a 500-character review or note, a 40-character name, and a 70-character word with no spaces, all of which the platform accepts.

### User Story 1 - Every admin page fits a phone (Priority: P1)

An administrator gets a report of an abusive review, or a request to revoke a certificate, while away from their desk. On a phone they open the page, find the review or the certificate, and act on it. Every page is as wide as the screen, and every action is on it.

**Why this priority**: Three of the portal's pages can't be used on a phone today:

- **Categories (B-01):** the page is 1,003px wide, and every Rename and Archive is off-screen.
- **Certificates (D-01):** a found certificate makes the page 528px wide, with Revoke off-screen.
- **Reviews (C-01):** a review or response holding a long word makes the page 455px wide.

The Recent changes table on Payments runs its columns together (E-01), long names spill over their cells (B-02), and a certificate's history entries run together (D-08).

**Independent Test**: With the audit's data (a 60-character category name with no spaces, a course with long reviews and responses, a certificate with a long learner name, course title and notes, a dozen payment changes), open Categories, Reviews with that course chosen, Certificates with that certificate looked up, and Payments, at both widths.

**Acceptance Scenarios**:

1. **Given** any admin page at phone width with long content, **When** it loads, **Then** it has no sideways scroll, and every control on it is fully on screen.
2. **Given** the categories list at phone width, **When** it shows, **Then** each category's name wraps in full on its own line, followed by its slug, then its status and course count, and its Rename and Archive buttons are on screen below them.
3. **Given** a category being renamed at phone width, **When** the name field shows, **Then** the field, Save and Cancel are on screen and the field is at least as wide as a short name.
4. **Given** a review or response holding a 70-character word, **When** it shows at either width, **Then** the word wraps inside the review.
5. **Given** a certificate with a long learner name and course title at phone width, **When** it is looked up, **Then** the name and title wrap, and Revoke or Restore is on screen below them.
6. **Given** a certificate's history with long notes, **When** it shows, **Then** each entry is visibly separate from the next.
7. **Given** Recent changes on Payments at phone width, **When** it holds data, **Then** column headers and values are separated by space, each date stays on one line, and the table scrolls within itself rather than the page.
8. **Given** desktop width, **When** any of the above is shown, **Then** it looks and works as it does today, apart from the long-content fixes.

---

### User Story 2 - Links, breadcrumbs and the home page lead somewhere real (Priority: P1)

An administrator uses the breadcrumb trail to step back from Branding, mistypes an address, or starts from the home page to find Payments. Every link takes them to a real page, named in words, and the home page leads to every area of the portal.

**Why this priority**:

- **Breadcrumbs (A-04, A-05):** the first crumb is a 4px-wide "/". "Settings" leads to a bare "Not Found" with no way back.
- **Not found (A-06):** an address with no page shows the words "Not Found", with no heading, no link home, and the raw address in the trail.
- **Home (A-08):** it leaves out Certificates, Payments and Branding. Branding can only be found in the user menu.

**Independent Test**: Open Branding and Notification settings and use every crumb, opening each in a new tab too. Open `/settings` and `/no-such-page`. From the home page, reach each area of the sidebar and the user menu.

**Acceptance Scenarios**:

1. **Given** any page, **When** its breadcrumb trail is shown, **Then** the first crumb reads "Home", every crumb is a word, and every crumb that is a link opens a page that exists.
2. **Given** Branding or Notification settings, **When** the trail is shown, **Then** "Settings" is plain text, not a link.
3. **Given** an address in the portal that matches no page, **When** it is opened, **Then** a "Page not found" page shows inside the portal's shell, with its own heading, a sentence, and a link to the home page.
4. **Given** the home page, **When** it loads, **Then** it has a card for Categories, Reviews, Certificates, Payments, Branding and Notification settings, each leading to its page.

---

### User Story 3 - Every page says where you are and what it is waiting for (Priority: P2)

An administrator with several portal tabs open can tell them apart. A screen-reader user who follows a link hears the new page's name. A page that is loading says what it is loading.

**Why this priority**:

- **Tab titles (A-01):** every page but Branding is titled "Discava".
- **Focus after following a link (A-02):** it stays on the link that was used, so a screen reader announces nothing.
- **First load and sign-in (A-07):** a blank page with a spinner in the corner and no words.
- **Loading (A-10):** Categories, Reviews, Certificates and Payments show a bare spinner.

Every page already has one main heading and one main landmark in each state; this story keeps that true.

**Independent Test**: Open each route in turn and read the tab's title, then follow sidebar links with the keyboard. Repeat with each page's requests delayed. Open the portal signed out.

**Acceptance Scenarios**:

1. **Given** any page of the admin portal, **When** it has loaded, **Then** the tab's title names the page and ends with "Discava", for example "Payments · Discava" or "Branding · Settings · Discava".
2. **Given** a keyboard or screen-reader user, **When** they follow a link to another page of the portal, **Then** focus moves to the new page's main heading and its name is announced.
3. **Given** a page or section whose content is waiting on a request, **When** it shows, **Then** it says in words what it is loading ("Loading the categories…"), and the waiting region is marked busy.
4. **Given** the portal opened signed out or before its settings have loaded, **When** it waits, **Then** it says what it is doing ("Loading Discava…", "Signing you in…") in the middle of the page.
5. **Given** each page in each of its states, **When** its headings are listed, **Then** there is exactly one main heading, no level is skipped, and there is one main landmark.

---

### User Story 4 - The keyboard keeps its place (Priority: P2)

An administrator moderates reviews, revokes certificates and manages categories with the keyboard. After every action (add, rename, archive, remove, revoke, restore, connect, replace, disconnect, save, close a dialog) focus is on the control they used, or on what took its place, and the result is announced.

**Why this priority**: The audit found focus lost on `<body>` after almost every action in the portal:

- Categories: a duplicate add (B-06), Rename's Save and Cancel (B-07), Archive (B-08);
- Reviews: every way of closing the Remove dialog, and the last Load more (C-05, C-06);
- Certificates: Cancel, revoke and restore (D-03);
- Payments: every action and confirmation (E-02, E-03);
- Branding: Save, the Reset-all confirmation and each image's Reset while uploading (F-03, F-07, F-09);
- the phone sidebar (A-03).

Almost none of them announce what happened (B-09, C-05, D-03, E-04, F-05), and two counters announce every keystroke (C-08, D-09).

**Independent Test**: With the keyboard alone, and with a screen reader on, do each action above and note where focus is afterwards and what is announced.

**Acceptance Scenarios**:

1. **Given** a button whose action takes time (Add category, Save, Remove review, Revoke certificate, Restore certificate, Connect Stripe, Save key, Disconnect Stripe, Save branding), **When** it is pressed, **Then** it keeps focus, says what it is doing ("Saving…", "Removing…"), ignores further presses until done, and focus is still on it afterwards when it is still there, whether the action succeeded or failed.
2. **Given** an action that removes or swaps its own control (archive a category, a review's Remove once it is removed, Revoke becoming Restore, the last Load more, Rename's Save and Cancel, Replace key's Cancel), **When** it completes, **Then** focus moves to the control that now stands in its place, or to the neighbouring item, or to the list itself when none is left.
3. **Given** Rename, **When** it is pressed, **Then** focus moves into the name field; **When** Escape is pressed in the field, **Then** the rename is cancelled.
4. **Given** a dialog closed by any means (Cancel, Close, Escape, a successful action, Go back, Keep connected), **When** it closes, **Then** focus returns to the control that opened it, or to the control that replaced it.
5. **Given** the phone sidebar, **When** a page is chosen in it, **Then** it closes and focus moves to the new page's main heading; **When** it is closed with Escape, **Then** focus returns to the button that opened it.
6. **Given** an action whose result the administrator waits for (a category added, renamed or archived; a review removed; a certificate revoked or restored; Stripe connected, its key replaced or disconnected; branding saved), **When** it completes, **Then** a short sentence says so and is announced once.
7. **Given** a character counter, **When** it changes, **Then** it is not announced on every keystroke.

---

### User Story 5 - Typed work is never lost by accident (Priority: P2)

An administrator writes a reason for removing a review, or a note for revoking a certificate. A stray Escape or click outside the dialog doesn't throw it away.

**Why this priority**: In the Remove review and Revoke certificate dialogs, Escape or a click outside discards the typed reason or note without asking (C-04, D-04). Branding asks before leaving with unsaved changes, but with the browser's own prompt, unlike every other question in the portal (F-04).

**Independent Test**: Type into each dialog, then press Escape, click outside, press Cancel and reopen. Change the branding and follow a sidebar link.

**Acceptance Scenarios**:

1. **Given** the Remove review or Revoke certificate dialog with something typed, **When** the administrator presses Escape or clicks outside it, **Then** they are asked whether to discard it, and choosing to keep editing returns them to the dialog with focus where it was.
2. **Given** either dialog with nothing typed, **When** it is dismissed by any means, **Then** it closes without asking.
3. **Given** either dialog, **When** Cancel is pressed and the dialog reopened, **Then** it is empty.
4. **Given** a failed removal or revocation, **When** the error shows, **Then** the dialog stays open with what was typed.
5. **Given** Branding with unsaved changes, **When** the administrator follows a link elsewhere in the portal, **Then** the portal's own "Leave without saving?" dialog asks first; closing or reloading the tab still uses the browser's prompt.

---

### User Story 6 - Errors and blocked actions say what to do next (Priority: P2)

When something fails to load or save, or an action can't be taken yet, the administrator sees a sentence that says what happened and what to do, where they are looking. A failed load can be retried in place.

**Why this priority**:

- **No way to retry:** Categories' failed load has none (B-03); a failed certificate lookup has none (D-02).
- **Hand-built errors:** Reviews and Payments build their own error blocks and Try again buttons (C-02, E-05), and Reviews' are disabled while retrying, which loses focus.
- **Errors in the wrong place:** Categories shows every failure in one "That didn't work" alert above the form, including a duplicate name, and a failed archive's error appears behind its closed confirmation (B-04).
- **Raw messages:** "Failed to fetch" on Notification settings (F-01).
- **Buttons disabled with no reason:** Add category, Rename's Save, Look up, Remove review, Revoke certificate with "Other", Save key, Connect Stripe and Branding's Save (B-05, C-03, D-05, E-06, F-03).
- **"Certificate not found"** says nothing of what to check (D-02).

**Independent Test**: Block the portal's requests in the browser and open each page, then use each action. Submit each form empty. Add a category whose name exists. Look up an ID that doesn't exist.

**Acceptance Scenarios**:

1. **Given** no connection, **When** any request in the admin portal fails, **Then** the message says the portal could not be reached and to check the connection and try again. It never shows "Failed to fetch" or another internal phrase.
2. **Given** a failed load of any page, list or lookup, **When** the error shows, **Then** it is shown once, with a heading and one "Try again" that repeats the request, and success replaces it with the content.
3. **Given** a form submitted empty or with a problem (a duplicate or empty category name, a review removal with no reason, a revocation for "Other" with no note, an empty Stripe key, an invalid brand name or colour), **When** it is submitted, **Then** the problem is shown next to its field and tied to it, and focus moves to that field. The submit button is never disabled just because a field is empty or invalid.
4. **Given** a confirmation whose action fails (archive a category), **When** the error appears, **Then** it appears inside that confirmation, and the confirmation stays open.
5. **Given** a failed add or rename, **When** the error appears, **Then** it is beside the form it concerns, under a heading that names the action ("Couldn't add the category").
6. **Given** a certificate ID that matches no certificate, **When** it is looked up, **Then** the message says no certificate has that ID and to check it against the certificate's page or PDF.
7. **Given** Branding with nothing changed, **When** it shows, **Then** Save says there is nothing to save in visible text, or saving with no changes says so, rather than a disabled button with no reason.

---

### User Story 7 - Views can be shared and come back to (Priority: P3)

An administrator picks a course on Reviews, or looks up a certificate, then reloads, presses Back, or sends the link to another administrator. The same view opens.

**Why this priority**: The chosen course on Reviews (C-07) and the looked-up certificate (D-06) are lost on reload and Back, and can't be linked to.

**Independent Test**: On each of the two pages, choose a view, reload, press Back and Forward, and open the address in a new tab.

**Acceptance Scenarios**:

1. **Given** Reviews with a course chosen, **When** the page is reloaded or its address opened elsewhere, **Then** the same course's reviews show, and the course picker shows it.
2. **Given** Certificates with a certificate looked up, **When** the page is reloaded or its address opened elsewhere, **Then** the same certificate shows, and the ID field holds its ID.
3. **Given** either view, **When** the administrator presses Back, **Then** the previous view shows, and the controls on screen match it.
4. **Given** a Reviews address for a course that isn't among the courses loaded so far, **When** it opens, **Then** that course's reviews still show, and the picker says the course is chosen from the link until it is found.

---

### User Story 8 - Controls are big enough and say what they are (Priority: P3)

An administrator using a touch screen, a voice-control tool or a screen reader can hit every control and knows what each does.

**Why this priority**:

- **Too small:** dialog close buttons are 16×16px (C-09), and switches are 36×20px with their text outside the target (F-02, F-08).
- **Unhelpful names:**
  - 17 "Rename" and 16 "Archive" buttons share their names (B-10);
  - three "Reset to default" buttons on Branding share one (F-06);
  - each home card's link is named by all of its text (A-09);
  - the replace confirmation says "Continue" and "Go back" (E-07).
- **Fields:** the certificate ID field is spell-checked (D-07), and a placeholder lacks its ellipsis (B-11).

**Independent Test**: Measure every control on each page and dialog at both widths. List each link's and button's accessible name.

**Acceptance Scenarios**:

1. **Given** any control an administrator must use, **When** it is measured, **Then** it is at least 24px by 24px, other than links inside a sentence. A switch and its text are one target.
2. **Given** a set of buttons with the same visible text, **When** their names are listed, **Then** each is told apart by the category or image it acts on ("Rename Science", "Reset the logo to default"), and each name contains the visible text.
3. **Given** a home card, **When** a screen reader reaches its link, **Then** the link is named by the area's title, and the whole card still opens the area.
4. **Given** the replace-key confirmation, **When** it shows, **Then** its buttons say what they do ("Replace the key", "Keep the current key").
5. **Given** the certificate ID field, **When** an ID is typed, **Then** it isn't spell-checked or auto-completed.

---

### User Story 9 - The rules and the tests cover the admin portal (Priority: P3)

Whoever next changes an admin page finds the patterns these fixes follow in the UI rules, and a test fails if an admin page scrolls sideways on a phone.

**Why this priority**: No admin page is in the phone-width e2e scenario, so all three P1 defects pass CI today (G-01). The UI rules have no check for a table at phone width, which is behind B-01 and E-01.

**Independent Test**: Revert the categories table fix locally and run the phone-width scenario; it fails. Read the UI rules for a check that covers a table with actions.

**Acceptance Scenarios**:

1. **Given** the end-to-end tests, **When** an admin page in this audit scrolls sideways at phone width, or puts a control off-screen, **Then** a test fails.
2. **Given** the end-to-end tests, **When** an admin breadcrumb links to a page that doesn't exist, or an unknown admin address shows no heading, **Then** a test fails.
3. **Given** the UI rules, **When** they are read, **Then** they say how a table fits a phone, and nothing in them conflicts with the existing rules or the instructor-portal additions.

### Edge Cases

- **No categories at all:** the list says there are none yet, beside the form that adds the first; at phone width nothing overflows.
- **An archived category:** its row has Rename but no Archive. At phone width its actions line holds Rename alone, and focus after archiving moves to that Rename.
- **The last review on the last page removed:** focus goes to the removed review's row, which now says "Removed", not to `<body>`.
- **A Reviews address for a course with no reviews, or one that no longer exists:** "No reviews yet", or the failed load's message with Try again, as when the course is chosen today.
- **A certificate address with an ID that matches nothing:** the not-found message of US6, with the ID in the field to correct.
- **Payments while a change is in progress:** the page refreshes every few seconds, as today; focus is not moved by a refresh, and the buttons that are unavailable say why in the existing "A change is in progress" message.
- **A failed save of the Stripe key:** the key field is emptied, as today, because the key must never stay in the page. Focus moves to the empty field, and the alert adds "Enter the key again to retry."
- **A signed-in user who isn't an administrator:** the restricted page is titled "Administrators only · Discava" and fits a phone, as today.
- **Text zoomed to 200% at desktop width:** the rules about sideways scroll still hold.
- **Unsaved branding when the session expires and the portal redirects to sign in:** the leave question is not asked, as in the instructor portal.

## Requirements *(mandatory)*

### Functional Requirements

**Layout at any width**

- **FR-001**: No page of the admin portal, and no dialog it opens, may scroll sideways or put a control off-screen at phone width or desktop width, with names, titles, reviews, responses, notes and words of any length the platform accepts.
- **FR-002**: At phone width, a table whose rows hold actions (categories) MUST show each row as a stacked block, with its name across the full width and its actions on screen. A read-only table (recent payment changes) MUST separate its columns visibly and scroll within itself when wider than the screen.
- **FR-003**: User-written text (category names, reviews, responses, reviewer and learner names, course titles, notes) MUST wrap within its container.

**Links and navigation**

- **FR-004**: The breadcrumb trail MUST start with "Home", name every crumb in words, and make a crumb a link only when its page exists.
- **FR-005**: An address that matches no page MUST show a "Page not found" page inside the portal's shell, with a main heading and a link home.
- **FR-006**: The home page MUST lead to every area of the portal: Categories, Reviews, Certificates, Payments, Branding and Notification settings.

**Where you are**

- **FR-007**: Every page MUST set the tab's title to its own name, then its parent's, then the platform's name ("Discava" unless the branding changes it), separated by " · ", and MUST keep exactly one main heading, with no skipped levels, and one main landmark in every state.
- **FR-008**: Following a link MUST move focus to the new page's main heading.
- **FR-009**: A page, section or the portal's first load waiting on a request MUST say in words what it is waiting for, and a busy button's label MUST say what it is doing.

**Keeping the keyboard's place**

- **FR-010**: A control whose action is running MUST keep focus, say that it is running, and ignore repeated presses. It MUST NOT leave the tab order while it runs.
- **FR-011**: After an action that removes, swaps or hides its own control, focus MUST move to the control in its place, the neighbouring item, or the list itself. It MUST never be left at the top of the document or a dialog.
- **FR-012**: Closing any dialog or the phone sidebar MUST return focus to the control that opened it, or to the control that replaced it. Choosing a page in the phone sidebar MUST close it.
- **FR-013**: The result of an add, rename, archive, removal, revocation, restoration, Stripe change or branding save MUST be announced once. A character counter MUST NOT be announced on every keystroke.
- **FR-014**: Rename MUST move focus into the name field, and Escape in the field MUST cancel the rename.

**Keeping typed work**

- **FR-015**: A failed action MUST keep everything the administrator typed, apart from a Stripe key, which is never kept.
- **FR-016**: Cancel MUST discard a dialog's input, so that reopening it shows it empty.
- **FR-017**: Escape or a click outside a dialog with typed input MUST ask before discarding it.
- **FR-018**: Leaving Branding with unsaved changes MUST ask first, with the portal's own dialog for links within the portal.

**Errors and waiting**

- **FR-019**: A failed request MUST be shown as a sentence written for people that includes a next step. The browser's and server's internal phrases MUST never be shown.
- **FR-020**: A failed load MUST be shown once, with a heading and one "Try again" that repeats its request.
- **FR-021**: A failed action MUST be shown where the administrator is looking: inside an open confirmation, or beside the form it concerns, under a heading that names the action.
- **FR-022**: A form's problems MUST be shown next to the fields they concern, tied to them, with focus moved to the first on submit. A submit button MUST NOT be disabled to signal an empty or invalid form. A button that can't be used MUST say why in visible text.
- **FR-023**: A lookup that finds nothing MUST say so and say what to check.

**State in the address**

- **FR-024**: The chosen course on Reviews and the looked-up certificate on Certificates MUST live in the address, so that reload, Back, Forward and a shared link restore them, and the controls on screen MUST match the address.

**Controls**

- **FR-025**: Every control an administrator must use MUST be at least 24px by 24px, other than links inside a sentence. A switch MUST form one target with its text.
- **FR-026**: A link's or button's accessible name MUST contain its visible text. Controls with the same visible text MUST be told apart by what they act on. A confirmation's buttons MUST say what they do.
- **FR-027**: A field for a code or an ID MUST NOT be spell-checked or auto-completed.

**What does not change**

- **FR-028**: No request the portal makes, and nothing a request does, may change. The same calls are made, with the same inputs, at the same moments. "Try again" repeats calls the page already makes. Reading a view from the address sends the same inputs the on-screen control sends today.
- **FR-029**: Buttons keep text labels only, with no arrow icons, as the project's conventions say.
- **FR-030**: A defect in a component the three portals share MUST be fixed in that component. Where the instructor-portal UX spec already plans the fix, this feature MUST use it, not repeat it, and MUST add the admin-portal checks that show it working there. No portal other than the admin portal is otherwise changed.

**Writing the rules down**

- **FR-031**: The portals' UI rules MUST gain a check for how a table fits a phone, without repeating or contradicting the existing rules or the instructor-portal additions.
- **FR-032**: The end-to-end tests MUST fail if an audited admin page scrolls sideways or puts a control off-screen at phone width, if an admin breadcrumb links to a page that doesn't exist, or if an unknown admin address shows no main heading.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At phone width, with long content, 0 admin pages are wider than the screen. Today 3 are: Categories 1,003px, Certificates 528px, Reviews 455px.
- **SC-002**: At phone width, 0 controls on admin pages sit outside the screen. Today every Rename and Archive on Categories, and Revoke on Certificates, do.
- **SC-003**: An administrator can rename and archive a category, remove a review and revoke a certificate on a phone, start to finish, without zooming or scrolling sideways. Today none of the four can be done.
- **SC-004**: 0 links or breadcrumbs lead to "Not Found", and an unknown address shows a page with a heading and a way home. Today both "Settings" crumbs and every unknown address show a bare "Not Found".
- **SC-005**: With the keyboard alone, focus is lost 0 times across the actions listed in User Story 4. Today the audit measured it lost after 17 of them, and the code shows more (Close buttons, Try again while retrying, Branding's Save).
- **SC-006**: Typed reasons and notes are lost 0 times by Escape or a click outside. Today both dialogs lose them.
- **SC-007**: With the network blocked, 0 screens show "Failed to fetch", and every failed load offers one Try again. Today Notification settings shows "Failed to fetch", and Categories and Certificates offer no Try again.
- **SC-008**: Every admin page has its own tab title, and no two pages share one. Today 8 of 9 (with the not-found and restricted pages) are titled "Discava".
- **SC-009**: 0 buttons are disabled to signal an empty or invalid form. Today 8 are.
- **SC-010**: No control an administrator must use is smaller than 24px in either direction, other than links inside a sentence.
- **SC-011**: Reloading Reviews and Certificates keeps the course and the certificate chosen. Today both reset.
- **SC-012**: Reverting any of the three P1 fixes makes an e2e test fail. Today none would.

## Assumptions

- **Audit data.** The measurements were taken on the local stack with data made for the audit, on `main` before #892. The layout defects depend on that data only in that long names and words make them visible.
- **What "without changing behaviour" covers.** Stacking a table's rows, keeping a view in the address, asking before discarding a reason, moving errors beside their forms and adding home cards change what is shown and when, not what is requested. That is within "without changing behaviour", which concerns requests and data.
- **Shared fixes come from the instructor-portal spec.** The breadcrumbs, the route announcer, the phone sidebar, the dialog close button, switch hit areas, notification settings' errors and the unsaved-changes guard are fixed there for every portal (its T016 and T021, T032, T040, T051, T052, T059, T073, T074). This feature's tasks that check them wait for them. If that spec's plan changes, the affected tasks here change with it.
- **Out of scope: the improvements in [audit.md](./audit.md).** A searchable course picker, unarchiving categories, notification settings that list only an administrator's notifications, figures on the new home cards, and a list of revoked certificates are new features or need new requests. They are recorded for later.
- **The Stripe key.** The key field is emptied on every submit, whatever the outcome, so that the key is never kept in the page. That stays; FR-015 excepts it.
- **Not checked.** Screen-reader announcements are checked by a person with a screen reader before merge; automated tests check focus and the markup that causes the announcement. Dark mode, a real phone's touch and the deployed Cognito sign-in were not checked by the audit and are not changed here.
- **The Web Interface Guidelines** are the public guidelines the project's `web-design-guidelines` skill fetches. The UI rules link to them and restate only what this project has decided.
