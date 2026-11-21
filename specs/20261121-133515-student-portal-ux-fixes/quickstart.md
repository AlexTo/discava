# Quickstart: checking the student portal UX fixes

## Prerequisites

- Docker running, `pnpm i` done, `pnpm dev` running.
- Once: `pnpm --filter @discava/e2e exec playwright install chromium`.

## Automated checks

```sh
pnpm nx run @discava/common-web-utils:test -- --run api-errors page-title
pnpm nx run @discava/common-shadcn:test -- --run responsive-panel route-announcer use-page-title error-alert quiz-card
pnpm nx run @discava/student-portal:test -- --run course-player course-page lesson-page site-layout site-search catalogue course-card enrolment-actions quiz-item signed-in-home
pnpm nx run @discava/instructor-portal:test
pnpm nx run @discava/admin-portal:test
pnpm nx e2e @discava/e2e -- phone-width learn quiz search public-landing-page
```

All pass. The instructor and admin portal suites run because the shared quiz card, `ErrorAlert` and `apiErrorMessage` changed under them. The e2e scenarios post their screenshots on the pull request.

## By hand (local stack)

Save screenshots of each step to `tmp/screenshots/pr-<number>/`. Check each step at 375px and at 1440px unless it says otherwise.

### Data to make (Alice, instructor portal)

1. A course whose title, first module title and first lesson title are each over 60 characters, with a 500-character description.
2. In its first lesson: a text item, and a quiz with three questions (one multiple choice, one with an option three lines long), two attempts, answers revealed after the final attempt.
3. A second lesson and a second module with one lesson.
4. As Carol in the admin portal, a category; back as Alice, give the course that category, a level, a language, a duration and three tags. Publish.

### US1: the lesson fits

5. Enrol and land on the first lesson at 375px. The page does not scroll sideways. "Course outline" is one closed line naming the lesson; the enrolled notice and the lesson title are on the first screen.
6. Open the outline: both modules, the current lesson marked. Choose the second lesson: it opens.
7. At 1440px the lesson column is about twice the outline's width.

### US2: links stay on the page

8. On the course's page, click each section tab and the "N modules" card. The address keeps `/learn/<id>` and gains `#modules` and so on; the heading is clear of the sticky bars.
9. Middle-click "Modules": the new tab opens the same course at that section.
10. In a lesson, middle-click the second step link: the new tab opens the lesson at the quiz.
11. On the signed-out home page, the footer has no "Terms" link, and "About" scrolls to the features section.

### US3: search on a phone

12. At 375px as Alice, the top bar fits; the avatar is whole. Open the user menu: "My Learning" and "Instructor" are its first entries.
13. Type three letters of the course's title in the search box: they are all visible, and the suggestions span the screen with titles on two lines.
14. At 1440px the top bar looks as it did.

### US4: filters

15. At 375px on the home page, a search and the category page, the first course is on the first screen and "Filters" is one closed line. Tick a filter: the line reads "Filters · 1 active".
16. At 1440px with the keyboard, Tab to a filter checkbox and press Space. The panel stays, the results dim and return, and focus is still on that checkbox. Press Tab then Space: the next filter toggles.
17. Tap between a checkbox and its label: it toggles.
18. On the category page, search for "zzzz", then press Back: the box is empty again.
19. Open `/search?query=` followed by a 70-character word at 375px: the heading wraps.

### US5: the quiz by keyboard

20. With a screen reader on, Tab to "Start quiz" and press Enter. The reader says "Question 1 of 3"; Tab reaches the navigator's "1", "2", "3", then the options.
21. Answer two questions, reach the review. It reads "This uses attempt 1 of 2." and the button is "Submit answers". Press it: the reader says the score and "Not passed".
22. Retake and pass. With answers revealed, the long option's tick is full size.
23. Block requests in the browser and submit: the error is read out, and the answers are still there.

### US6: errors

24. With requests blocked: enrol, reload a lesson, reload the signed-in home. Each says "Couldn't reach Discava. Check your connection and try again." Loads offer "Try again"; unblock and press it: the content appears without a reload.

### US7: titles and headings

25. Visit home, a search, the course, a lesson and Alice's profile, reading the tab's title each time against [contracts/page-titles.md](./contracts/page-titles.md). Press Back through them: each title follows its page.
26. With a screen reader, follow a link from the home page to a course: the reader says the course's title.
27. Open `/signin` signed out with the network throttled: "Signing you in…" shows beside the spinner.

### US8: cards and profile

28. On the home page the long-description course's card is about the height of its neighbours; its title's lines do not touch; clicking the title or the picture opens the course; Tab stops once per card.
29. Alice's profile shows a 112px circle. A new instructor with no published course shows "No published courses yet."
30. With "reduce motion" on in the system settings, a lesson's step link jumps without animation and the next Tab is inside that item.

### US9: the rules

31. Start a new agent session in `packages/websites/student-portal` and ask what UI rules apply: it answers from `packages/websites/CLAUDE.md` without being pointed to it.
32. Read that file beside the root `CLAUDE.md`: nothing is stated twice.

## Not changed, to confirm

- The network panel shows the same requests as on `main` for each page, in the same order, plus only what "Try again" repeats.
- The instructor portal's quiz preview works with the keyboard as the student's quiz does.
