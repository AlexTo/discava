# Audit: Instructor Portal UX (2026-11-22)

The findings this feature fixes, one line each. [spec.md](./spec.md) groups them into user stories, and [research.md](./research.md) gives the root cause and fix for each group.

**How it was done.** Five auditors each walked part of the instructor portal on the local stack (`pnpm dev`). Each signed in as a new instructor with data made for the audit:

- 90-character titles, 500-character descriptions and questions, and a 70-character word with no spaces;
- a course with 6 modules of 5 lessons, a 12-question quiz, videos (one whose processing failed), files, an upload assignment with four submissions, 24 questions and 12 reviews from 12 students;
- earnings answers stubbed in the browser.

Each screen was checked:

- at 375px and 1440px;
- in its loading, empty, error (requests blocked in the browser) and long-content states;
- with the keyboard alone;

against [packages/websites/CLAUDE.md](../../packages/websites/CLAUDE.md) and the Web Interface Guidelines. The screenshots are in the git-ignored `tmp/screenshots/instructor-portal-audit/area-{a..e}/`, and the throwaway scripts that made the data are in `packages/e2e/tmp/audit/`.

**Severity**:

- **P1**: blocks a task on a phone or with the keyboard.
- **P2**: makes a task confusing or hard.
- **P3**: polish.

**Story**: the user story in [spec.md](./spec.md) that fixes the finding. Paths are relative to `packages/websites/instructor-portal/src/routes/_authenticated/` unless they start with `packages/`.

Several auditors found the same defect. Where they did, it is listed once, with every ID that found it.

## Area A: the shell, sign-in, home, earnings, profile, notification settings

| ID | Sev | Where | Finding | Story |
|----|-----|-------|---------|-------|
| A-01 (B-15, C-16, E-11) | P2 | every route | No route calls `usePageTitle`. All 14 screens are titled "Discava" | US4 |
| A-02 | P2 | shell | `PortalShell` doesn't mount `RouteAnnouncer`, so after following a link focus stays on the sidebar link or user menu button, and nothing is announced | US4 |
| A-03 | P2 | shell, 375px | The phone sidebar stays open after a page is chosen (it covers 288 of 375px). Escape leaves focus on `<body>` | US5 |
| A-04 (B-16) | P2 | shell | The first breadcrumb's text is "/", and it is a 4×20px target | US2 |
| A-05 (E-04) | P2 | shell | Every path segment is a link: "Settings" (`/settings`) and "Assignments" lead to a bare, unstyled "Not Found" outside the shell. Course and item segments show raw UUIDs, and the review page's crumb says "Submissions" | US2 |
| A-06 | P3 | `/earnings` | The crumb reads "earnings" in lower case | US2 |
| A-07 | P2 | `/signin`, deep link while signed out | A blank page with a corner spinner and no words. The `main.tsx` fallbacks are the same | US4 |
| A-08 | P2 | `/` | The "Give feedback" button has no handler and does nothing | US2 |
| A-09 | P2 | `/`, long title | Course card titles are clipped, and the status badge is pushed off the card (1440px) or cut to "Pub" (375px) | US3 |
| A-10 | P2 | `/earnings`, "Show orders" | A failed orders load has no Try again, and a failed "Load more" shows nothing | US7 |
| A-11 (B-06) | P3 | `/`, `/earnings` (4 cards), `/profile`, `/dashboard`, `/dashboard/$courseId`, quiz panel | Hand-made "Retry" buttons outside the alert, instead of `ErrorAlert`'s `onRetry` ("Try again") | US7 |
| A-12 | P2 | `/profile` loading, error | No `h1` (it is inside the form), and a bare spinner | US4 |
| A-13 | P2 | `/profile` | Focus drops to `<body>` after Save, both on success and on failure (the button is disabled while saving) | US5 |
| A-14 | P2 | `/profile` validation | Errors aren't tied to their fields with `aria-describedby`, there is no alert, and Save is disabled with no explanation | US7 |
| A-15 | P2 | `/settings/notifications` (shared `notification-preferences.tsx`) | A failed save says "Couldn't save. Failed to fetch". A failed load gives no reason and no Try again | US7 |
| A-16 | P2 | `/settings/notifications` | 13 switches at 36×20px, and their text isn't part of the target | US9 |
| A-17 | P2 | `/earnings` period picker | "Custom range" and "Choose a month" unmount themselves and leave focus on `<body>` | US5 |
| A-18 | P3 | `/earnings` | "Show orders" toggles are 20px tall | US9 |
| A-19 | P3 | `/earnings` | The headings go h1, then h3 "USD", then h2. The card titles aren't headings | US4 |
| A-20 | P3 | `/earnings` tables, 375px | No horizontal cell padding: "DateOrder reference" and "AmountStatus" run together, dates wrap to three lines, and the payouts table doesn't scroll | US3 |
| A-21 | P3 | `/earnings` | The chosen period isn't in the address | US8 |
| A-22 | P3 | `/earnings`, `/settings/notifications`, `/` "Your courses" | Loading shows skeletons or a spinner with no words and no `aria-busy` | US4 |
| A-23 (B-22, C-16, E-12) | P3 | 10 routes | Two nested `<main>` landmarks: `SidebarInset`'s and the route's own | US4 |
| A-24 | P3 | `/earnings` payout card | "Set up payouts" and the other payout buttons give no sign they are working | US9 |

## Area B: dashboards and My Courses

| ID | Sev | Where | Finding | Story |
|----|-----|-------|---------|-------|
| B-01 | **P1** | `/dashboard/$courseId`, 375px, with students | The page is 673px wide. "Lesson drop-off" and "Activation" are 649px wide because a `truncate` title sits in a grid child without `min-w-0` | US3 |
| B-02 | P2 | `/dashboard`, `/dashboard/$courseId`, long word | The pages are 667px and 792px wide (card title, `h1`, breadcrumb) | US3 |
| B-03 | P2 | quiz score chart, 375px | The ten band labels overlap (`interval={0}`) | US3 |
| B-04 | P2 | most-missed questions table | A long word doesn't wrap, so "Misses" and "Miss rate" are hidden behind an inner scroll even at 1440px | US3 |
| B-05 | P2 | `/dashboard/$courseId` error, not found | No heading at all and no `<main>`. Not found offers no way back | US4 |
| B-07 | P2 | `/my-courses` error | No way to retry | US7 |
| B-08 | P2 | `/my-courses`, new instructor | Shows "No courses found – Try another search or status filter", with a "Clear filters" that does nothing and no Create course | US7 |
| B-09 | P2 | `/my-courses` | The status filter and search aren't in the address, so a reload or Back loses them | US8 |
| B-10 | P2 | `/my-courses` cards | Descriptions aren't clamped (676px cards next to 436px ones). A long word is clipped, and the badge is pushed out | US3 |
| B-11 | P2 | Create course dialog | Cancel keeps the typed text for the next opening. Escape resets it | US6 |
| B-12 | P2 | Create course dialog | Saving empty or failing leaves focus on `<body>` (Save is disabled while focused). The error isn't tied to its field | US5, US7 |
| B-13 | P2 | after creating a course | Focus is on `<body>` on the new course's page (it returns to an unmounted trigger) | US5 |
| B-14 | P2 | `/my-courses` | "Clear filters" removes itself and leaves focus on `<body>` | US5 |
| B-17 (D-19, E-19) | P3 | every dialog (shared `ui/dialog.tsx`) | The close button is 16×16px | US9 |
| B-18 | P3 | lesson drop-off | The counts show only on hover or focus, each `<li>` is a tab stop, and cut titles can't be read | US3 |
| B-19 | P3 | `/my-courses` loading | "0 courses shown" beside a lone 16px spinner | US4 |
| B-20 | P3 | `/dashboard` cards | A whole card is one link, named by all of its text | US9 |
| B-21 | P3 | `/my-courses` | Nine "Open course" links share one name | US9 |
| B-23 | P3 | `/my-courses` | Only the first 100 courses load; the cursor is never followed | out of scope (see spec Assumptions) |

## Area C: the course editor page

| ID | Sev | Where | Finding | Story |
|----|-----|-------|---------|-------|
| C-01 | **P1** | module headers and lesson rows, 375px | The rows don't wrap and the module card clips them, so 67 controls sit beyond x=375 (Edit, Remove, Hide, Make free preview). Titles shrink to 75px | US1 |
| C-02 | **P1** | landing page checklist | The "Add it" links are `<a href="#…">` and go to the portal home. The three share one name. The profile link reloads the app | US2 |
| C-03 | P2 | page as a whole | 20,337px tall at 375px. "Course content" starts 5,892px down, after five settings sections, with no in-page navigation | US10 |
| C-04 | P2 | load error | No Try again, no `h1`, and a raw UUID in the breadcrumb | US4, US7 |
| C-05 | P3 | whole-page loading | A bare spinner | US4 |
| C-06 | P2 | reorder failure | "Couldn't reorder the lessons / Failed to fetch", then focus on `<body>` (the list remounts) | US5, US7 |
| C-07 | P2 | certificates switch, criteria checkbox, Save prompt, captions Save, Save landing page, Save price, Save catalogue | Saving disables the focused control, so focus falls to `<body>` | US5 |
| C-08 | P2 | delete or restore rows, free preview toggle, tags, landing items, maths popover Cancel, announcement Post, Edit, Cancel and Delete, course Restore, failed Publish | An action removes or swaps its own control and leaves focus on `<body>` | US5 |
| C-09 | P2 | first-lesson prompt, price | A failed save resets the field to the saved value, so the typed text is lost | US6 |
| C-10 | P2 | Edit module, Edit lesson, create dialogs | Cancel keeps unsaved text, and a later Save writes it | US6 |
| C-11 | P2 | dialogs and page forms | A click outside discards a dialog's typed work. Leaving the page drops unsaved settings without a warning | US6 |
| C-12 | P2 | announcements, draft course | The form shows on a draft, and the post then fails with "Only a published course can have announcements" | US7 |
| C-13 | P2 | announcement with a long word, 375px | The page is 530px wide (the `h3` has no `break-words`) | US1 |
| C-14 | P2 | archived section, 375px | Titles get 13px ("L."), and rows are about 680px tall | US1 |
| C-15 | P2 | certificates switch, criteria checkbox, tag Remove, Reviews and Questions links | 36×20, 16×16 with a gap before its label, 45×16, 20px tall | US9 |
| C-16 | P3 | headings | h1 is followed by h3 "First-lesson prompt", and "No lessons yet" is an h4 under an h2 | US4 |
| C-17 | P3 | Save buttons, "Saved" notes, Post announcement | "Saving" has no ellipsis. Status regions mount with their text, so they may not be announced. Posting confirms nothing | US9 |
| C-18 | P3 | maths popover, 375px | 384px wide, so Insert is clipped | US1 |
| C-19 | P3 | module buttons | Named by position ("Edit module 2"), not by title | US9 |
| C-20 | P3 | delete lesson, disabled "Delete permanently", checklist profile line, category select | The item count isn't stated. The reason is in a `title` tooltip only. A failed load shows "Checking…" forever or silently empty options | US7 |

## Area D: lesson-item dialogs

| ID | Sev | Where | Finding | Story |
|----|-----|-------|---------|-------|
| D-01 | **P1** | video questions dialog | One collapsed long question makes the content 3,804px wide, with Save at x=3,909px. The dialog's auto grid track grows to fit the `truncate` summary | US1 |
| D-02 | **P1** | quiz builder, New assignment (quiz), 375px | The save bar doesn't wrap: Save quiz sits at x=354–463, the dialog is 471–487px wide, and question controls are off-screen | US1 |
| D-03 | P2 | Edit text, Edit file, captions, 375px | Content 552px and 579px wide in a 341px dialog (long word in the editor or file name) | US1 |
| D-04 | **P1** | lesson item rows, 375px | Titles get 0px in the video, quiz and file rows. The video row needs 501px, so the page is 399px wide | US1 |
| D-05 | P2 | video row | A failed or pending video isn't explained in words; the reason is a tooltip on a disabled button | US7 |
| D-06 | P2 | text, video, file and assignment dialogs | Escape or a click outside discards typed work, including an uploaded video. New assignment's quiz has no dirty guard | US6 |
| D-07 | P2 | quiz builder, video questions save | "Couldn't save the quiz / Failed to fetch" | US7 |
| D-08 | P2 | "Keep editing", quiz preview close | Focus goes to `<body>` (the dialogs are opened from state with no trigger) | US5 |
| D-09 | P2 | quiz question reorder | Focus ends on the dialog, and it announces "Picked up draggable item q3" | US5 |
| D-10 | P2 | remove question, move to the top | Focus drops to the dialog root | US5 |
| D-11 | P2 | quiz builder, New assignment validation | Focus stays on Save, fields get no `aria-invalid` or `aria-describedby`, and errors aren't linked | US7 |
| D-12 | P2 | Add video, wrong file type | Silently ignored | US7 |
| D-13 | P2 | captions removal failure | The error renders behind the open confirmation, under an `aria-hidden` overlay | US7 |
| D-14 | P2 | caption upload | Focus goes to `<body>`, and success isn't announced | US5 |
| D-15 | P2 | video questions, player fails to load | No error, the add buttons vanish, and there is no loading text | US7 |
| D-16 | P2 | video questions "Current time" | A `role="status"` clock is announced every second | US5 |
| D-17 | P3 | upload network failure | "Failed to upload the video file" with no next step: `putFileWithProgress` rejects with a plain `Error` | US7 |
| D-18 | P3 | captions loading, error; Edit video loading | No words, no Try again | US7 |
| D-19 | P2 | quiz option radios and checkboxes, quiz settings checkboxes, "At the end" switch, `HlsVideo` thumbs | 16×16 or 36×20, with gaps before labels | US9 |
| D-20 | P3 | "Questions (3)", video questions "Move up" | The accessible name doesn't contain the visible text | US9 |
| D-21 | P3 | Edit text, video, file, captions | No dialog description (the intro is a plain `<p>`) | US9 |
| D-22 | P3 | Edit text, Add video, Add file | Save is disabled with no reason given | US7 |
| D-23 | P3 | upload progress, drop zone, captions initial focus | Progress isn't announced. The drop zone is unnamed (`role="presentation"`). Focus opens on "Remove English" | US5, US9 |

## Area E: questions, reviews, submissions and grading

| ID | Sev | Where | Finding | Story |
|----|-----|-------|---------|-------|
| E-01 | **P1** | question thread dialog, 375px | Content 589px in a 341px dialog (shared `PostCard` flex children lack `min-w-0`, plus the dialog's auto track) | US3 |
| E-02 | **P1** | submission review, 375px | 586px wide: the PDF preview is fixed at 560px in a grid without `minmax(0,1fr)`, and a long name in the `h1` | US3 |
| E-03 | **P1** | reviews, 375px | 515px wide: review and response text lack `break-words`, and a long name runs under Respond | US3 |
| E-05 | P2 | thread dialog close | Two different Dialogs (loading, then loaded) leave nothing to return focus to, so focus lands on `<body>` | US5 |
| E-06 | P2 | Post reply, Hide, Unhide, Mark as answer | Focus goes to the dialog container, and nothing says the reply was posted | US5 |
| E-07 | P2 | Load more (last page), Reported tab actions | Focus goes to `<body>`, with no status | US5 |
| E-08 | P2 | grading form | After Return, Edit grade or Cancel focus is on `<body>`, and nothing announces the result | US5 |
| E-09 | P2 | Delete response | Focus goes to `<body>`, with no confirmation | US5 |
| E-10 | P2 | questions | The open tab and the chosen lesson aren't in the address | US8 |
| E-13 | P3 | By lesson list, thread dialog | Question titles are `h4` under the `h1` | US4 |
| E-14 | P2 | submission review error, loading | No Try again, no `h1`, and skeletons with no words | US4, US7 |
| E-15 | P2 | reviews error; paged list, by lesson, submissions table | The error shows twice and its one Try again refetches half. Error blocks are hand-rolled | US7 |
| E-16 | P3 | grading Points | The error is far from the field, and not tied to it | US7 |
| E-17 | P3 | grading Feedback | The label has no `htmlFor` | US9 |
| E-18 | P3 | Return, Save grade, Request resubmission | No "…ing" label while saving | US9 |
| E-20 | P3 | thread and response counters | `aria-live` reads the count on every keystroke | US5 |

## Improvements suggested, not in this feature

Recorded for later features; [spec.md](./spec.md) Assumptions says why each is out:

- Sort My Courses by update, title or enrolments, kept in the address.
- After grading, a link to the next waiting submission. Filter the submissions list by status.
- Unanswered and reported counts on the course editor's Questions link, and new reviews on Reviews.
- One save, or autosave, for the course settings instead of five Save buttons.
- Collapsible modules with expand all and collapse all. One "Add content" menu per lesson instead of the four-button bar.
- One shared upload drop zone for video, file and captions.
- The quiz builder as a full-screen sheet on phones.
- Weekly buckets or a visible table for the 90-day charts on phones.
- The header avatar using the profile's display name.
- My Courses following the cursor past 100 courses (B-23): a request change, so a bug fix of its own.
