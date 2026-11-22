# Quickstart: checking the instructor portal UX fixes

How to check each story by hand on the local stack. The automated checks are the component tests beside each changed file and the e2e scenarios named in [tasks.md](./tasks.md). This guide is for the reviewer, and for the **(human)** tasks.

## Prerequisites

1. Start Docker, then run `pnpm dev`, which serves the instructor portal at <http://localhost:4200>.
2. Sign in under "Someone else" on the local sign-in page as a new user with the `instructor` and `student` groups, so the data is yours alone.
3. Make the audit's data (the e2e helpers in `packages/e2e/src/helpers/` do it through the API):
   - a course with 3 modules of 3 lessons, with titles of 60 to 90 characters and one 70-character word;
   - a lesson with a text item, a video, a file and a 12-question quiz whose first question is 500 characters;
   - an upload assignment with a submitted PDF;
   - a few students' questions and reviews.
4. Have two browser windows ready: one at **375×812**, one at **1440×900**. In DevTools, keep a way to block requests (Network → Block request URL, or offline mode).

Throughout:

- **Sideways scroll** means `document.documentElement.scrollWidth > clientWidth`, or, for an open dialog, the dialog's `scrollWidth > clientWidth`.
- **Focus** means `document.activeElement` in the console.

## US1: the course editor works on a phone

At 375px, open the course:

1. Every module and lesson control (Edit, Remove, Hide, free preview, the add-item buttons) is on screen, with the titles wrapping above them.
2. Each item row shows its title.
3. Open the quiz: Save quiz is on screen, and the dialog has no sideways scroll. Collapse the long question: still none.
4. Open the video questions at 1440px with the long question collapsed: the dialog is 1,022px wide, and Save is visible.
5. Open Edit text with a 70-character word in the body, and Edit file with a 70-character file name: neither scrolls sideways.
6. In the archived section and the maths popover, the titles are readable and Insert is visible.

## US2: links and breadcrumbs

1. On a submission, the trail reads "Home › My Courses › <course> › <assignment> › <student>". The assignment crumb opens the submissions list, and there is no "Assignments" link.
2. On notification settings, "Settings" is text, not a link.
3. Open `/no-such-page`: "Page not found" shows inside the shell.
4. On a draft course's checklist, each "Add it" link scrolls to its section and keeps the course's address (`#landing-page`), including when opened in a new tab.
5. The home page has no "Give feedback" card.

## US3: every page fits a phone

At 375px, check that none of these pages scrolls sideways, and that no dialog they open does:

- the course's analytics (with students);
- the dashboard;
- My Courses;
- home;
- questions and a thread;
- reviews;
- the submissions list;
- a submission (the PDF fits);
- earnings.

Also check that the score chart's labels don't overlap, and that course cards keep their badges.

## US4: where you are

1. Read each tab's title against [contracts/page-titles.md](./contracts/page-titles.md).
2. With the keyboard, follow a sidebar link: focus lands on the new page's `h1`.
3. Block requests and open the course's analytics, the course editor, a submission and the profile. Each has its `h1` and one `main`, and says what failed.
4. With requests slowed, each whole-page wait says what it is loading.

## US5: the keyboard keeps its place

With the keyboard only, check focus after each of these:

- saving the price, prompt and catalogue settings;
- the certificates switch;
- deleting a lesson;
- restoring an archived module;
- toggling free preview;
- removing a tag;
- posting, editing and deleting an announcement;
- reordering lessons and quiz questions;
- removing a quiz question;
- Keep editing;
- closing Preview as student;
- choosing Custom range on earnings;
- Save on the profile;
- replying, hiding and dismissing on questions;
- returning a grade, then Edit grade and Cancel;
- deleting a review response;
- choosing a page in the phone sidebar.

Focus is never on `<body>`. With a screen reader, each result is announced once, and the reply counter and video clock are silent.

## US6: typed work

1. Type a new prompt, block requests, then Save: the text stays.
2. Edit a module title, Cancel, reopen: the saved title shows.
3. Type in New lesson and click outside: "Discard unsaved changes?" appears. Keep editing returns you to the field.
4. Upload a video, then press Escape: the same question appears.
5. Change the price and click "My Courses" in the sidebar: "Leave without saving?" appears. Reload the tab: the browser asks.

## US7: errors

With requests blocked, open each page and dialog, and save in each:

- no "Failed to fetch" appears;
- every failed load has one Try again, which recovers it.

Also check:

1. Submit New assignment empty: focus goes to the first field, and its error is read with it.
2. Choose a PDF in Add video: a message names the accepted types.
3. Open a draft course's announcements: it says to publish first.
4. Open My Courses as a brand-new instructor: "You don't teach any courses yet" with Create course.

## US8: views in the address

1. Filter My Courses to Draft and search, then reload: same view.
2. Open the questions page's Reported tab, then By lesson with a lesson chosen, and reload: same view.
3. Pick a past month on earnings and reload: same period.
4. Back steps through each change.

## US9: controls

1. Measure the dialog close button, the switches, the quiz option checkboxes, "Show orders" and the tag Remove buttons: each is at least 24×24.
2. Click a switch's text: it toggles.
3. List the links on My Courses: each "Open course" names its course.

## US10: the course editor's order

1. At 375px, "Course content" is in the first screen below the header card.
2. Each section link scrolls to its section, focuses its heading and updates `#…`.

## US11: the rules

1. Read the new bullets in `packages/websites/CLAUDE.md` against [contracts/ui-rules.md](./contracts/ui-rules.md).
2. Run `pnpm nx e2e @discava/e2e -- phone-width` and check that the instructor cases pass.
