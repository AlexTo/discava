---

description: "Task list for the instructor portal UX fixes"
---

# Tasks: Instructor Portal UX Fixes

**Input**: Design documents from `/specs/20261123-000428-instructor-portal-ux-fixes/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [audit.md](./audit.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The Discava constitution (principle IV) requires tests, so they are included:

- **Component tests** for each shared piece and each changed screen.
- **E2e:** instructor cases in `phone-width.e2e.ts`, a new `instructor-views.e2e.ts`, and extensions to `breadcrumbs` and `quiz`.

The feature writes no shared record, so there is no invariant work. Write each task's tests first and watch them fail. Never weaken an existing test to make it pass: the expectations this feature changes on purpose are listed in plan.md's "Tests that change meaning", named in the task that changes them, and the pull request says so.

**Who runs what**:

- **The agent:** an automated agent implements these tasks without `pnpm dev` or Docker. It runs unit and component tests, lint, typecheck and `build` locally.
- **PR CI:** the agent writes the e2e tests, but PR CI runs them (`pr-checks.yml`'s `E2E tests` job). A CI failure is the feedback for those.
- **People:** tasks marked **(human)** need a running local stack or people (a screen reader, a real phone), and a reviewer does them before merging.

**Organization**:

- **Phases:** there are thirteen. Each is one agent pull request and leaves `main` green, except that Phases 1 and 2 form the first one: the first story's phase ends the first implementation issue.
- **Order:** Phases 3 to 12 depend only on Phase 1 and can merge in any order, apart from the pairs in "Dependencies". Phase 6 (US5) and Phase 8 (US7) are large, and may each land as two pull requests (course editor and dialogs; other pages), each completing its own tasks.
- **Paths:** paths are relative to the repository root. `IP/` stands for `packages/websites/instructor-portal/src/routes/_authenticated/`, `IPC/` for `IP/my-courses_/$courseId/-components/`, and `SH/` for `packages/common/shadcn/src/`.
- **Parent issue:** there is none. Pull requests say "Part of the instructor portal UX fixes spec" and link `spec.md`.

| Label | Story | Priority |
|-------|-------|----------|
| US1 | The course editor works on a phone | P1 |
| US2 | Links and breadcrumbs lead somewhere real | P1 |
| US3 | Every page fits a phone, whatever the content | P1 |
| US4 | Every page says where you are and what it is waiting for | P2 |
| US5 | The keyboard keeps its place | P2 |
| US6 | Typed work is never lost by accident | P2 |
| US7 | Errors and blocked actions say what to do next | P2 |
| US8 | Lists and views can be shared and come back to | P3 |
| US9 | Controls are big enough and say what they are | P3 |
| US10 | The course editor's content is quick to reach | P3 |
| US11 | The rules are written down for the next change | P3 |

**Rules for every task**:

- **No request changes (FR-031):** do not add, remove or reorder a query or mutation, or change an input. "Try again" calls an existing query's `refetch`.
- **Text-only buttons:** buttons carry text only, with no arrow icons.
- **Shared fixes stay shared:** a fix to a shared component is made in `packages/common/shadcn`, not overridden in the portal. A change there runs the tests of every portal that uses the component (`packages/common/shadcn/CLAUDE.md`).
- **shadcn `ui/` files:** a change to a file in `SH/components/ui/` is named in the pull request with the rule that needs it.
- **Screenshots:** every e2e task that changes what a user sees calls `screenshot()` on the changed screen.
- **Finding IDs:** these are from [audit.md](./audit.md). Each task names the ones it fixes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)

---

## Phase 1: Foundational - shared pieces and the on-screen checks

**Goal**: The shared pieces several stories use, and the e2e helpers that catch clipped controls and oversized dialogs. Nothing users see changes.

**Independent test**: `pnpm nx run @discava/common-shadcn:test -- --run` passes with the new tests.

- [x] T001 [P] Test first, then add `PendingButton` in `SH/components/pending-button.tsx` as [contracts/shared-components.md](./contracts/shared-components.md) describes (research R-5).
  - **Props:** `Button`'s, plus `pending: boolean` and `pendingLabel: string`.
  - **While pending:** `aria-disabled="true"`, the same dimmed classes `disabled` gives, `onClick` ignored, and a submit button's form submission prevented (`onClickCapture` with `preventDefault` for `type="submit"`). It shows `pendingLabel`, and never sets `disabled`.
  - **Tests** in `pending-button.test.tsx:**
    - a focused button that becomes pending keeps focus;
    - clicks while pending don't call `onClick`;
    - a form whose submit button is pending doesn't submit;
    - the label switches back when pending ends.
- [x] T002 [P] Test first, then add `useReturnFocus(open)` in `SH/hooks/use-return-focus.ts` (research R-6).
  - **Behaviour:** it records `document.activeElement` when `open` becomes true. It returns `onCloseAutoFocus(event)`, which, if the recorded element is still connected, focuses it and calls `event.preventDefault()`.
  - **Tests** with a Radix `Dialog` opened from state, with no trigger:
    - focus returns to the button focused before opening;
    - if that button was removed, the default runs and nothing throws.
- [x] T003 [P] Test first, then add `StatusMessage` in `SH/components/status-message.tsx` (research R-14).
  - **Props:** `message: string | null`, `visuallyHidden?: boolean`, `clearAfter?: number` (default 5000).
  - **Behaviour:** the `role="status"` element is always rendered. Setting the same message twice clears it for one frame, then sets it again.
  - **Tests (fake timers):**
    - the region exists while empty;
    - the text appears, then clears after `clearAfter`;
    - a repeated message is set again.
- [x] T004 [P] Test first, then add `LoadingState` in `SH/components/loading-state.tsx` (research R-4).
  - **Props:** `label: string` and `size?: 'page' | 'section'`.
  - **Behaviour:** it renders the existing `Spinner` beside `label` in a `role="status"` region. `page` centres it with `min-h-[50vh]`.
  - **Tests:** the label is the region's text, and the role is `status`.
- [x] T005 [P] In `packages/e2e/src/helpers/viewport.ts`, add two helpers beside `expectNoSidewaysScroll` (research R-15). Neither is used yet.
  - **`expectOnScreen(locator)`:** with `expect.poll`, asserts that every match is visible and its bounding box lies within `0 ≤ x` and `x + width ≤ innerWidth`. On failure it names the first five that don't, with their accessible names (`aria-label` or text).
  - **`expectDialogFits(dialog)`:** asserts the dialog's `scrollWidth` is not greater than its `clientWidth`, and its right edge is within the viewport.
- [x] T006 Run `pnpm nx run @discava/common-shadcn:test` (once), lint and typecheck for `common-shadcn` and `e2e`, and fix failures in the code, not the tests.

---

## Phase 2: User Story 1 - The course editor works on a phone (Priority: P1) 🎯 MVP

**Goal**: At 375px:

- every module, lesson and item control in the course editor is on screen;
- every item says what it is;
- every lesson-item dialog fits, with its Save in reach.

At 1440px nothing changes, apart from long-content fixes.

**Independent test**: quickstart, US1.

- [x] T007 [US1] Test first in `SH/components/ui/dialog.test.tsx` (new), then change `DialogContent` in `SH/components/ui/dialog.tsx`: add `grid-cols-[minmax(0,1fr)]` to its classes (research R-1; D-01, D-03, E-01).
  - **Test:** assert the class is present; jsdom has no layout.
  - **Pull request:** name the shadcn-file change and the no-sideways-scroll rule.
  - **Other portals:** run the tests of the student, instructor and admin portals.
- [x] T008 [P] [US1] Test first in `IPC/course/course-modules.test.tsx`, then change the module header and the lesson row in `IPC/course/course-modules.tsx` to the wrapping layout of research R-2 (C-01):
  - the row becomes `flex flex-wrap items-center gap-2`;
  - the title block is `min-w-0 basis-full break-words sm:basis-0 sm:flex-1`;
  - the controls sit in a `flex flex-wrap items-center gap-1` group, with nothing `shrink-0` that could push past the edge.

  Keep every control's accessible name. **Tests:**
  - with a 90-character title and a 70-character word, the title element has `break-words` and `min-w-0`;
  - the controls group wraps (`flex-wrap`);
  - every control is still present by name.
- [x] T009 [P] [US1] Test first in `IPC/content-items/lesson-content-items-row.test.tsx`, then apply the same layout to the item row in `IPC/content-items/lesson-content-items-row.tsx` (D-04):
  - the kind icon and title share the first line, the title being `min-w-0 flex-1 break-words`;
  - the controls (Questions, Captions, Hide or Publish, Edit, Remove, Preview) wrap below `sm`;
  - the four add-item buttons wrap.

  **Test:** every row's title text is rendered and not hidden, for each item kind.
- [x] T010 [P] [US1] Test first, then wrap the save bar in `IPC/content-items/quiz/quiz-save-bar.tsx` (D-02):
  - the outer row becomes `flex flex-wrap`;
  - the status text takes `basis-full sm:basis-auto`;
  - the button group wraps.

  Add `min-w-0` to the question card's root and summary in `IPC/content-items/quiz/question-card.tsx`, and to the question card in `IPC/content-items/video-questions/video-questions-editor.tsx` (D-01). **Tests** in `quiz-builder.test.tsx`: the classes are present, and Save quiz, Preview as student and Close are still rendered.
- [x] T011 [P] [US1] Test first, then make long words wrap in the lesson-item dialogs (D-03):
  - add `break-words [overflow-wrap:anywhere]` to the editor content in `IPC/rich-text-editor.tsx` (the `EditorContent` class and the ProseMirror paragraph styles);
  - add `break-words` and `min-w-0` to the file name in `IPC/content-items/attach-lesson-file-dialog.tsx`.

  **Tests** in the existing test files.
- [x] T012 [P] [US1] Test first in `IPC/course/archived-section.test.tsx`, then lay out each archived row as in T008 (C-14):
  - the text block takes `min-w-0 basis-full break-words sm:basis-0 sm:flex-1`;
  - Restore and Delete wrap below it.
- [x] T013 [P] [US1] Test first, then fix two long-content defects:
  - add `break-words` to the announcement title in `IPC/announcements/announcements-section.tsx` (C-13);
  - make the maths popover `w-[min(24rem,calc(100vw-2rem))]` in `IPC/math-popover.tsx` (C-18).
- [x] T014 [US1] Add instructor cases to `packages/e2e/src/scenarios/phone-width.e2e.ts`, at `PHONE`, with a new instructor (`newUser('Iris', ['instructor', 'student'])`). Build the course through the instructor API (`apiUserFor` in `helpers/assignment.ts`, `helpers/api.ts`):
  - three modules of three lessons, with titles of 60 to 90 characters, one a 70-character word;
  - a lesson with a text item, a video item (`helpers/video.ts`), a file item and a quiz of 12 questions, the first 500 characters long;
  - two archived lessons.

  **Assert:**
  - `expectNoSidewaysScroll`;
  - `expectOnScreen` on every button in the "Course content" section;
  - each item row's title is visible.

  Then open the quiz builder and collapse the first question; open the video questions with the long question; open Edit text with a 70-character word in the body. For each: `expectDialogFits`, and `expectOnScreen` on its Save.

  Screenshots: `'course editor at phone width'`, `'quiz builder at phone width'`, `'video questions with a long question'`.
- [x] T015 [US1] Run `pnpm nx run @discava/instructor-portal:test` (once), the student and admin portals' tests (for T007), lint, typecheck and `pnpm nx run @discava/instructor-portal:build`. Fix failures in the code.

---

## Phase 3: User Story 2 - Links and breadcrumbs lead somewhere real (Priority: P1)

**Goal**: Every crumb is a word and leads to a page that exists; the checklist's links stay on the course page; unknown addresses get a page inside the shell; no control does nothing.

**Independent test**: quickstart, US2.

- [x] T016 [US2] Test first in `SH/components/portal-shell.test.ts`, then change `getBreadcrumbs` and `PortalShell` in `SH/components/portal-shell.tsx` (research R-3; A-04, A-05):
  - **Root crumb:** its text is "Home".
  - **`routeExists`:** `getBreadcrumbs` takes `routeExists: (href: string) => boolean` in place of `availableRoutes`. `PortalShell` builds it with `useRouter()` and `router.matchRoutes(href)`: true when the deepest match is neither the root route nor a not-found match.
  - **Unmatched crumbs:** a crumb without a route has no `href`, and is rendered with `BreadcrumbPage` as text, never `href="#"`.
  - **Size and wrapping:** crumb links get `min-h-6 inline-flex items-center`, and the list gets `break-words`.
  - **Tests:**
    - the root is "Home";
    - `/settings/notifications` gives "Settings" as text and "Notification settings" as the page;
    - an override label replaces an id segment;
    - no crumb has `href="#"`.
- [x] T017 [P] [US2] Label the instructor portal's crumbs (A-05, A-06, E-04):
  - In `packages/websites/instructor-portal/src/components/app-layout.tsx`, add `earnings: 'Earnings'`, `settings: 'Settings'`, `notifications: 'Notification settings'`, `questions: 'Questions'`, `reviews: 'Reviews'`, `submissions: 'Submissions'` and `assignments: 'Assignments'` to `segmentLabels`.
  - In `IP/my-courses_/$courseId_/questions/route.tsx`, `IP/my-courses_/$courseId_/reviews.tsx`, `IP/my-courses_/$courseId_/assignments/$contentItemId/submissions/index.tsx` and `.../submissions/$userId.tsx`, call `useBreadcrumbLabel` for the course path with the course's title, from the query each page already makes.
  - The two submissions pages also label the `$contentItemId` path with the assignment's title, and the review page labels its own path with the student's name.

  **Tests** in each route's existing test file: the crumb texts.
- [x] T018 [P] [US2] Test first, then add a `notFoundComponent` to `IP/route.tsx` (A-05). It renders, inside `AppLayout`, an `h1` "Page not found", a sentence, and a `Link to="/"` "Go to the home page". Also set `defaultNotFoundComponent` in `createRouter` in `packages/websites/instructor-portal/src/router.ts` to the same component, so an unmatched path under the shell uses it. **Test:** an unknown path renders the heading inside the shell.
- [x] T019 [P] [US2] Test first in `IPC/course/landing-page-checklist.test.tsx`, then change `IPC/course/landing-page-checklist.tsx` (C-02):
  - each "Add it" link becomes `<Link to="." hash="<section id>">` with `aria-label="Add it: <item name>"`;
  - the profile line becomes `<Link to="/profile">`.
  - make sure the targets have the matching ids (`landing-page`, `course-image`, `preview-video`) in `IPC/course/landing-page-card.tsx`, `IPC/course/course-image.tsx` and `IPC/course/preview-video-area.tsx`.

  **Tests:**
  - no `a[href^="#"]` remains;
  - the links' `href`s include the course path and the hash;
  - the names differ.
- [x] T020 [P] [US2] Remove the "Give feedback" card from `IP/index.tsx` (A-08, clarification). In `IP/-index.test.tsx`, remove or invert any assertion on it, and say so in the pull request.
- [x] T021 [US2] Extend `packages/e2e/src/scenarios/breadcrumbs.e2e.ts`. As a new instructor with an upload assignment and one submission (`helpers/assignment.ts`), open the submission page and assert:
  - the trail is Home › My Courses › <course title> › … › <assignment title> › <student name>;
  - no crumb shows a UUID;
  - every crumb link, opened, gives a page whose `h1` is not "Page not found".

  Then:
  - open `/settings/notifications` and assert "Settings" is not a link;
  - open `/no-such-page` and assert "Page not found" inside the shell;
  - on a draft course, click each checklist "Add it" link and assert the URL path is still the course's and the hash names the section.

  Screenshots: `'breadcrumbs on a submission'`, `'page not found'`.
- [x] T022 [US2] Run the instructor and admin portals' and `common-shadcn`'s tests, lint, typecheck and build. Fix failures in the code.

---

## Phase 4: User Story 3 - Every page fits a phone, whatever the content (Priority: P1)

**Goal**: At 375px, with long content, no page outside the course editor scrolls sideways, cards keep their badges, charts and tables are readable.

**Independent test**: quickstart, US3.

- [x] T023 [P] [US3] Test first in `IP/dashboard_/$courseId/-route.test.tsx` and `-components/lesson-drop-off.test.tsx`, then make course analytics fit (B-01, B-02, B-18).
  - **`IP/dashboard_/$courseId/route.tsx`:**
    - the cards' grid tracks become `xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]`, and each card wrapper `min-w-0`;
    - the `h1` gets `break-words`.
  - **`-components/lesson-drop-off.tsx`:**
    - titles wrap (`break-words`, no `truncate`);
    - the started and completed counts are always visible (remove the hover and focus opacity);
    - the `li`s lose `tabIndex`.
  - **`-components/activation-card.tsx`:** text gets `break-words`.
- [x] T024 [P] [US3] Test first, then fix the quiz panel's chart and table (B-03, B-04):
  - in `IP/dashboard_/$courseId/-components/score-chart.tsx`, below 480px of container width, label every other band. Take the width from recharts' `ResponsiveContainer` (`onResize`, or a render prop), never read it during render;
  - in `-components/quiz-panel.tsx`, the question cells get `break-words [overflow-wrap:anywhere]`.
- [x] T025 [P] [US3] Test first, then fix the course cards (A-09, B-02, B-10) in `IP/index.tsx`, `IP/dashboard/route.tsx` and `IP/my-courses/route.tsx`:
  - `CardTitle` gets `min-w-0 break-words`;
  - `CardDescription` gets `line-clamp-3 break-words`;
  - the status `Badge` gets `shrink-0`;
  - the title-and-badge row wraps.

  **Tests:** the classes, in each page's test file.
- [x] T026 [P] [US3] Test first in `SH/discussion/post-card.test.tsx` (create it if absent), then in `SH/discussion/post-card.tsx` give the title and the author name `min-w-0 break-words` (E-01). Run the student portal's discussion tests too.
- [x] T027 [P] [US3] Test first in `IP/my-courses_/$courseId_/assignments/$contentItemId/submissions/-review.test.tsx`, then make the submission review fit (E-02):
  - **`.../submissions/$userId.tsx`:** the grid becomes `lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]`, with `min-w-0` on both sections, and the `h1` gets `break-words`.
  - **`.../submissions/-components/pdf-preview.tsx`:** the page's `width` is `Math.min(560, containerWidth)`, with `containerWidth` read by a `ResizeObserver` in an effect (start at 560 until measured).

  Extend `-pdf-preview.test.tsx` with a mocked `ResizeObserver` reporting 300px, and assert the page width is 300.
- [x] T028 [P] [US3] Test first in `IP/my-courses_/$courseId_/-components/-reviews.test.tsx`, then in `IP/my-courses_/$courseId_/-components/reviews-screen.tsx` give the reviewer name, the review text and the response text `break-words` (E-03).
- [x] T029 [P] [US3] Test first, then fix the earnings tables (A-20):
  - in `IP/earnings/-components/course-lines.tsx` and `IP/earnings/-components/payouts-list.tsx`, cells get `px-2`, and dates and amounts get `whitespace-nowrap`;
  - the payouts table is wrapped in `overflow-x-auto`.
- [x] T030 [US3] Extend `packages/e2e/src/scenarios/phone-width.e2e.ts`. As a new instructor, set up:
  - a published course whose title has a 70-character word;
  - six students enrolled through `helpers/review.ts`, with quiz attempts (`helpers/student-portal.ts` `takeQuiz`) and 500-character reviews;
  - a question thread with a 500-character body (`helpers/discussion.ts`);
  - an upload assignment with a PDF submission from a student whose name is 40 characters.

  At `PHONE`, `expectNoSidewaysScroll` on:
  - `/dashboard`;
  - `/dashboard/<id>`;
  - `/my-courses`;
  - `/`;
  - the questions page;
  - reviews;
  - the submissions list;
  - the submission;
  - `/earnings`.

  Then `expectDialogFits` on the open thread dialog. Wait for analytics with `helpers/wait-for-analytics.ts` before the analytics page.

  Screenshots: `'course analytics at phone width'`, `'submission at phone width'`, `'thread at phone width'`.
- [x] T031 [US3] Run the instructor and student portals' and `common-shadcn`'s tests, lint, typecheck and build. Fix failures in the code.

---

## Phase 5: User Story 4 - Every page says where you are and what it is waiting for (Priority: P2)

**Goal**: Every route sets its title, keeps one `h1` and one `main` in every state, moves focus on navigation, and says what it is loading.

**Independent test**: quickstart, US4.

- [x] T032 [US4] Test first in `SH/components/portal-shell.test.ts` (or a new `portal-shell.test.tsx`), then render `<RouteAnnouncer containerId={MAIN_CONTENT_ID} pathname={pathname} />` in `SH/components/portal-shell.tsx` (A-02). **Test:** after a pathname change, the new `h1` in the content area is focused. Run the admin portal's tests.
- [x] T033 [P] [US4] Call `usePageTitle` (`@discava/common-shadcn/hooks/use-page-title`) in every instructor route, with the parts in [contracts/page-titles.md](./contracts/page-titles.md) (A-01):
  - `packages/websites/instructor-portal/src/routes/signin.tsx`;
  - the restricted page in `IP/route.tsx`;
  - `IP/index.tsx`;
  - `IP/dashboard/route.tsx`;
  - `IP/dashboard_/$courseId/route.tsx`;
  - `IP/my-courses/route.tsx`;
  - `IP/my-courses_/$courseId/route.tsx`;
  - `IP/my-courses_/$courseId_/questions/route.tsx`;
  - `IP/my-courses_/$courseId_/reviews.tsx`;
  - the two submissions routes;
  - `IP/earnings/route.tsx`;
  - `IP/profile.tsx`;
  - `IP/settings/notifications.tsx`;
  - the not-found component (if Phase 3 has merged; otherwise Phase 3 adds it).

  **Tests:** each route's test file asserts `document.title`, loaded and while loading.
- [x] T034 [P] [US4] Keep the `h1` in every state (A-12, B-05, C-04, E-14). Move each page's `h1` (and its header) outside the loading and error branches, with the fallback names of [contracts/page-titles.md](./contracts/page-titles.md):
  - `IP/dashboard_/$courseId/route.tsx`: "Course analytics";
  - `IP/my-courses_/$courseId/route.tsx`: "Course";
  - `IP/my-courses_/$courseId_/assignments/$contentItemId/submissions/$userId.tsx`: "Submission";
  - `IP/profile.tsx`: "Profile". Move the heading and intro out of `ProfileForm`.

  For a not-found error, add a link back to the list (Dashboard, My Courses, or the submissions list). **Tests:** in each route's test file, with the query failing and pending, exactly one `h1` is present.
- [x] T035 [P] [US4] Replace each route's own `<main>` with a `<div>` (A-23) in these files:
  - `IP/index.tsx`;
  - `IP/dashboard/route.tsx`;
  - `IP/dashboard_/$courseId/route.tsx`;
  - `IP/my-courses/route.tsx`;
  - `IP/my-courses_/$courseId/route.tsx`;
  - `IP/my-courses_/$courseId_/questions/route.tsx`;
  - `IP/my-courses_/$courseId_/reviews.tsx`;
  - both submissions routes;
  - `IP/earnings/route.tsx`.

  Update any test that finds the page by `getByRole('main')`, so it renders inside the shell or uses another landmark.
- [x] T036 [P] [US4] Fix the heading levels (A-19, C-16, E-13):
  - **Course editor:** add an `h2` "Course settings" before the settings sections in `IP/my-courses_/$courseId/route.tsx`. Make `IPC/course/course-first-lesson-prompt-form.tsx`'s heading an `h3` under it, and "No lessons yet" in `IPC/course/course-modules.tsx` an `h3`.
  - **Earnings:** make the card titles in `IP/earnings/-components/payout-account-card.tsx`, `balance-card.tsx` and `payouts-list.tsx` `h2`s, and the currency headings `h3`s.
  - **Discussion:** add `headingLevel?: 2 | 3 | 4` (default 4) to `SH/discussion/post-card.tsx`. Pass 2 from the questions lists (`IP/my-courses_/$courseId_/questions/-components/paged-list.tsx`, `by-lesson-view.tsx`, `reported-view.tsx`) and 3 inside `thread-dialog.tsx`.

  **Tests:** heading order.
- [x] T037 [P] [US4] Use `LoadingState` (T004) for every whole-page or whole-section wait (A-07, A-22, B-19, C-05, E-14):
  - `packages/websites/instructor-portal/src/routes/signin.tsx`: "Signing you in…", `size="page"`, under a visually hidden `h1` "Signing in", so the page has its one main heading (FR-012, A-07);
  - the `RuntimeConfigProvider` and `CognitoAuth` fallbacks in `packages/websites/instructor-portal/src/main.tsx`: "Loading Discava…";
  - `IP/my-courses_/$courseId/route.tsx`: "Loading the course…";
  - `IP/profile.tsx`: "Loading your profile…";
  - the "Your courses" section of `IP/index.tsx`: "Loading your courses…";
  - `IP/my-courses/route.tsx`: "Loading your courses…", hiding the "N courses shown" count until loaded;
  - the submission review: "Loading the submission…".

  `IP/earnings/-components/*`'s skeletons gain `aria-busy="true"` on their card and a visually hidden "Loading…" text.
- [x] T038 [US4] Extend `packages/e2e/src/scenarios/breadcrumbs.e2e.ts`, or add `packages/e2e/src/scenarios/instructor-pages.e2e.ts`. As a new instructor, visit each route in [contracts/page-titles.md](./contracts/page-titles.md) and assert:
  - its title;
  - exactly one `h1`;
  - exactly one `main`.

  Then press Enter on the sidebar's "Earnings" link and assert the focused element is the Earnings `h1`. With `page.route` aborting `course.view`, open the course editor and assert one `h1`. Screenshot: `'course editor load error'`.
- [x] T039 [US4] Run the instructor and admin portals' and `common-shadcn`'s tests, lint, typecheck and build. Fix failures in the code.

---

## Phase 6: User Story 5 - The keyboard keeps its place (Priority: P2)

**Goal**: After every action, focus is on the control used or what replaced it, never on `<body>` or a dialog's root, and results are announced once.

**Independent test**: quickstart, US5.

- [x] T040 [US5] Test first in the portal-shell test, then change `SH/components/portal-shell.tsx` (A-03):
  - close the phone sidebar when the pathname changes (`useSidebar().setOpenMobile(false)` in an effect on `pathname`);
  - give the sidebar's `SheetContent` an `onCloseAutoFocus` that focuses the `SidebarTrigger` (a ref), unless navigation is under way (then `RouteAnnouncer` moves focus).

  The shared `ui/sidebar.tsx` may need a prop to pass `onCloseAutoFocus` through; if so, name it in the pull request.
- [x] T041 [P] [US5] Replace `disabled={…isPending…}` with `PendingButton` (T001) on every save, post and submit button (C-07, A-13, A-24, E-18). Each file's existing tests that assert `toBeDisabled()` while pending change to `aria-disabled` (plan, "Tests that change meaning"). The pending labels:

  | File | Pending label |
  |------|---------------|
  | `IPC/course/course-price-form.tsx` | "Saving…" |
  | `IPC/course/course-catalogue-form.tsx` | "Saving…" |
  | `IPC/course/course-first-lesson-prompt-form.tsx` | "Saving…" |
  | `IPC/course/landing-page-card.tsx` | "Saving…" |
  | `IPC/course/course-caption-languages-form.tsx` | "Saving…" |
  | `IPC/course/course-status-actions.tsx` | "Publishing…", "Archiving…", "Restoring…" |
  | `IP/profile.tsx` | "Saving…" |
  | `IP/earnings/-components/payout-account-card.tsx` | "Opening Stripe…" |
  | `IP/my-courses_/$courseId_/assignments/$contentItemId/submissions/-components/grading-form.tsx` | "Returning…", "Saving…", "Requesting…" |
  | `IP/my-courses_/$courseId_/questions/-components/thread-dialog.tsx` (Post reply) | "Posting…" |
  | `IP/my-courses_/$courseId_/questions/-components/moderation.tsx` | "Hiding…", "Unhiding…", "Marking…" |

  The "Saved" note of the price, catalogue, first-lesson prompt, landing page and caption languages forms becomes a `StatusMessage` (T003) set on success, in place of a `role="status"` span mounted together with its text (C-17, research R-14). **Test:** in each form's test, the region exists before saving and reads "Saved" after.

  The certificates switch (`IPC/course/course-certificates-switch.tsx`) and the criteria checkbox (`IPC/course/course-certificate-criteria.tsx`) stay enabled while saving, ignore changes until the save settles, and set `aria-busy` on their row.
- [x] T042 [P] [US5] Make the course editor's lists keep focus when an item goes or changes (research R-6; C-08, C-06).
  - **In `IPC/course/course-modules.tsx`:** keep a ref map of each module's and lesson's first control by id. After delete or archive succeeds, focus the next item's, else the previous one's, else the "Course content" heading (`tabIndex={-1}`). Do the same in `IPC/course/archived-section.tsx` after Restore or Delete.
  - **Free preview:** make `IPC/lesson/free-preview-button.tsx` one button whose label switches between "Make free preview" and "Remove free preview", so focus never moves. In `free-preview-button.test.tsx`, update the assertions that the button is replaced; the names stay.
  - **Tags and landing items:** after removing a tag (`IPC/course/course-catalogue-form.tsx`) or a landing item, or moving one to an end (`IPC/course/landing-page-card.tsx`), focus the neighbouring item's control.
  - **Failed reorder (`IPC/sortable-list.tsx`):** show `apiErrorMessage(cause)` for non-conflict errors, and after the rollback remount, focus the moved item's handle by id.

  **Tests:** in each component's test file, after the action `document.activeElement` is the expected element.
- [x] T043 [P] [US5] Announcements, maths popover and Create course (C-08, B-13, B-14):
  - **Announcements:** in `IPC/announcements/announcements-section.tsx` and `announcement-form.tsx`:
    - Edit focuses the title field;
    - Cancel and Save focus the item's Edit button;
    - Delete focuses the next item's Edit, else the section heading;
    - Post focuses the title field and shows `StatusMessage` "Announcement posted".
  - **Maths popover:** Cancel in `IPC/math-popover.tsx` returns focus to the editor (`IPC/rich-text-editor.tsx` passes a `focus` callback).
  - **Create course:** in `packages/websites/instructor-portal/src/components/create-course-dialog.tsx`, when closing to navigate, call `event.preventDefault()` in `onCloseAutoFocus`.
  - **Clear filters:** in `IP/my-courses/route.tsx`, it focuses the search box.
- [x] T044 [P] [US5] Quiz and video questions (D-08, D-09, D-10, D-16):
  - **Return focus:** use `useReturnFocus` (T002) in `IPC/content-items/quiz/quiz-builder-dialog.tsx`, for its discard confirmation and the preview, in `IPC/content-items/quiz/quiz-preview-dialog.tsx`, and in `IPC/content-items/video-questions/video-questions-dialog.tsx`.
  - **Reorder announcements:** in `IPC/content-items/quiz/sortable-question-list.tsx`, pass `accessibility={{ announcements, screenReaderInstructions }}` naming "Question N" and the prompt's first 40 characters, and the new position "of M", phrased like `IPC/sortable-list.tsx`. Refocus the moved handle by id after the drop.
  - **Remove and move:** after `removeQuestion` (`IPC/content-items/quiz/use-quiz-builder-state.ts`), and after `remove` or `move` (`IPC/content-items/video-questions/use-video-questions-editor.ts`), focus the neighbouring question's header control, or the other move button when one becomes disabled.
  - **Clock:** remove `role="status"` from the clock in `video-questions-editor.tsx`.
  - **First or last item:** for a question that can't move further, its Move up (or Move down) control is disabled and skipped by Tab (spec Edge Cases). Focus never rests on it after a move, because the other move button takes it. **Test:** after moving question 2 up to first place, focus is on its "Move down".

  **Tests** in the existing test files.
- [x] T045 [P] [US5] Captions and uploads (D-14, D-23):
  - **Captions:** in `IPC/content-items/video-captions-dialog.tsx`, the upload button is a `PendingButton`. After an upload, `StatusMessage` says "<Language> captions added", and focus moves to the new track's row (its Remove button). The dialog opens on its Language select (`onOpenAutoFocus`).
  - **Uploads:** in `IPC/content-items/attach-lesson-video-dialog.tsx` and `attach-lesson-file-dialog.tsx`:
    - put "Uploading… n%" and "uploaded" in `role="status"`;
    - give the drop zone `role="button"` and `aria-label="Choose a video file"` / `"Choose a file"`, instead of `role="presentation"`.
- [x] T046 [P] [US5] Questions, reviews and grading (E-05 to E-09, E-20):
  - **Thread dialog:** `IP/my-courses_/$courseId_/questions/-components/thread-dialog.tsx` renders one `Dialog`, and swaps only its body between loading, error and loaded. Its `onCloseAutoFocus` focuses the row's open button if it is still there, else the next row's, else the list's heading.
    - After Post reply, focus the reply textarea and show `StatusMessage` "Reply posted".
    - The counter drops `aria-live`, and is referenced by `aria-describedby`.
  - **Load more:** in `paged-list.tsx`, after Load more, focus the first new row. On the last page, focus that row before the button unmounts.
  - **Reported actions:** in `reported-view.tsx`, after Dismiss, Hide or Delete, focus the next row (else the tab panel's heading) and show `StatusMessage` "Report dismissed", "Post hidden" or "Post deleted".
  - **Review responses:** `IP/my-courses_/$courseId_/-components/delete-response-dialog.tsx` focuses the row's Respond button on close after a delete, and shows "Response deleted". `response-dialog.tsx`'s counter drops `aria-live`.
  - **Grading:** in `.../submissions/-components/grading-form.tsx`:
    - after Return or Save grade, focus the "Returned" summary (`tabIndex={-1}`, in a `StatusMessage` "Grade returned");
    - Edit grade focuses Points;
    - Cancel focuses Edit grade.
- [x] T047 [P] [US5] Earnings and profile (A-13, A-17):
  - **Period picker:** in `IP/earnings/-components/period-picker.tsx`, after "Custom range" focus the From field, and after "Choose a month" focus the Month field.
  - **Profile:** in `IP/profile.tsx`, after Save the button keeps focus (T041), "Profile saved." stays in its status region, and on failure the alert is announced and focus stays on Save.
- [x] T048 [US5] Extend `packages/e2e/src/scenarios/quiz.e2e.ts`. As a new instructor, build a quiz with three questions, reorder one with Space, ArrowDown and Space, and assert that:
  - focus is on its handle;
  - the live region names "Question";
  - no raw id appears.

  Remove a question and assert focus is on a question header. Then:
  - in a course with two lessons, delete one and assert focus is on the other's control;
  - toggle free preview with Enter and assert focus is on the same button.

  Screenshot: `'quiz reorder by keyboard'`.
- [x] T049 [US5] Run the instructor and admin portals' and `common-shadcn`'s tests, lint, typecheck and build. Fix failures in the code.
- [ ] T050 [US5] (human) With a screen reader (NVDA or VoiceOver), do the actions in [quickstart.md](./quickstart.md) US5. Confirm:
  - each result is announced once;
  - the reply counter and video clock are silent;
  - the reorder announcements name questions by title.

  Note any gap in the pull request.

---

## Phase 7: User Story 6 - Typed work is never lost by accident (Priority: P2)

**Goal**: Failed saves keep input; Cancel resets; dismissing a dirty dialog or leaving a dirty editor asks first.

**Independent test**: quickstart, US6.

- [x] T051 [US6] Test first, then move the quiz builder's discard confirmation into shared code (research R-8, [contracts/shared-components.md](./contracts/shared-components.md)).
  - **New files:** `SH/components/discard-changes-dialog.tsx` and `SH/hooks/use-discard-guard.tsx` (`.tsx`: it returns JSX), returning `contentProps` (`onEscapeKeyDown`, `onInteractOutside`), `requestClose` and `confirmation`. The wording is unchanged: "Discard unsaved changes?", "Keep editing", "Discard changes". Keep editing returns focus through `useReturnFocus`.
  - **Callers:** switch `IPC/content-items/quiz/quiz-builder-dialog.tsx` and `IPC/content-items/video-questions/video-questions-dialog.tsx` to it. Their tests must pass unchanged.
- [x] T052 [US6] Test first, then add `useUnsavedChangesGuard(dirty)` in `SH/hooks/use-unsaved-changes-guard.tsx`. It returns `{ confirmation }` for the caller to render once, as [contracts/shared-components.md](./contracts/shared-components.md) says.
  - **Mechanism:** it uses TanStack Router's `useBlocker` with `shouldBlockFn: () => dirty`, `withResolver: true` and `enableBeforeUnload: () => dirty`. The blocker's state drives the `AlertDialog` returned as `confirmation`: "Leave without saving?", with **Stay** (first, which calls `reset`) and **Leave** (which calls `proceed`).
  - **Tests:**
    - with `dirty` false, navigation proceeds;
    - with `dirty` true, it shows the dialog;
    - Stay cancels and Leave navigates.
  - **Callers:** move the `beforeunload` listeners in `IPC/content-items/quiz/use-quiz-builder-state.ts` and `IPC/content-items/video-questions/use-video-questions-editor.ts` onto it. Their dialogs (`quiz-builder-dialog.tsx`, `video-questions-dialog.tsx`) render its `confirmation`.
- [x] T053 [P] [US6] Keep input after a failed save (C-09). Remove the `catch`-block resets in `IPC/course/course-first-lesson-prompt-form.tsx` and `IPC/course/course-price-form.tsx`. **Tests:** after a mocked failure, the field holds the typed value, and Save sends it again. Change any existing assertion that the field resets, and say so in the pull request.
- [x] T054 [P] [US6] Make Cancel reset (B-11, C-10). In each dialog, close through the same handler as Escape (the one that resets the form), or wrap Cancel in `DialogClose asChild`:
  - `packages/websites/instructor-portal/src/components/create-course-dialog.tsx`;
  - `IPC/module/create-module-dialog.tsx` and `edit-module-dialog.tsx`;
  - `IPC/lesson/create-lesson-dialog.tsx` and `edit-lesson-dialog.tsx`;
  - `IPC/content-items/edit-lesson-text-dialog.tsx`;
  - `attach-lesson-video-dialog.tsx` and `attach-lesson-file-dialog.tsx`;
  - `IPC/assignment/create-assignment-dialog.tsx` and `edit-assignment-dialog.tsx`;
  - `IP/my-courses_/$courseId_/-components/response-dialog.tsx`.

  **Tests:** type, Cancel, reopen, and the saved value shows.
- [x] T055 [US6] Guard the dialogs in T054 with `useDiscardGuard` (T051), with `dirty` from the form's dirty state (C-11, D-06):
  - for the video and file dialogs, `dirty` is also true once an upload has finished and isn't yet saved;
  - in `IPC/assignment/create-assignment-dialog.tsx`, wire `QuizBuilder`'s `onDirtyChange`, and ask before switching the kind radio away from a dirty quiz.

  **Tests:** Escape on a dirty dialog shows the confirmation; Keep editing returns to the field; on a clean dialog Escape closes.
- [x] T056 [US6] Guard the course editor's settings (C-11).
  - **Context:** add `IPC/course/unsaved-changes-context.tsx` with a provider in `IP/my-courses_/$courseId/route.tsx` that collects dirty flags by section key. The route calls `useUnsavedChangesGuard(anyDirty)` and renders its `confirmation`.
  - **Reporters:** these report their dirty state through the context:
    - `course-catalogue-form.tsx`;
    - `course-price-form.tsx`;
    - `course-first-lesson-prompt-form.tsx`;
    - `landing-page-card.tsx`;
    - `course-caption-languages-form.tsx`;
    - `announcement-form.tsx`.
  - **Archived course:** an archived course reports nothing.

  **Test:** a dirty price form, then a navigation to `/my-courses`, shows "Leave without saving?".
- [x] T057 [US6] Extend `packages/e2e/src/scenarios/quiz.e2e.ts`, or add `packages/e2e/src/scenarios/unsaved-work.e2e.ts`. As a new instructor:
  - type a lesson title in New lesson and press Escape: assert the confirmation, then Keep editing, and the title is still there;
  - change the price and click "My Courses" in the sidebar: assert "Leave without saving?", then Stay;
  - with `page.route` aborting `course.setFirstLessonPrompt` (or the prompt's mutation), save a new prompt: assert the field still holds it.

  Screenshot: `'discard unsaved changes'`.
- [x] T058 [US6] Run the instructor and admin portals' and `common-shadcn`'s tests, lint, typecheck and build. Fix failures in the code.

---

## Phase 8: User Story 7 - Errors and blocked actions say what to do next (Priority: P2)

**Goal**: No internal phrase reaches the screen; every failed load has one working Try again; problems, wrong types, processing states and unavailable actions are said in words where the instructor is looking.

**Independent test**: quickstart, US7.

- [x] T059 [P] [US7] Replace error sentences that bypass the helper (D-07, C-06, A-15, D-17):
  - **`apiErrorMessage(error)`:** in `IPC/content-items/quiz/quiz-save-bar.tsx` and `IPC/content-items/video-questions/video-questions-editor.tsx`, use it in place of `.message`.
  - **Uploads:** `packages/websites/instructor-portal/src/lib/put-file-with-progress.ts` rejects with `new TypeError(failureMessage, { cause })` on `xhr.onerror`. The video and file dialogs' alert headers read "Couldn't upload the video" and "Couldn't upload the file" for upload failures.
  - **Notification settings:** in `SH/components/notification-preferences.tsx`:
    - a failed save shows `apiErrorMessage` beside its switch;
    - a failed load is an `ErrorAlert` with `onRetry`;
    - loading is `LoadingState` "Loading your notification settings…".

    Run the student portal's notification settings tests.

  **Tests:** a `TypeError('Failed to fetch')` shows "Couldn't reach Discava…".
- [x] T060 [P] [US7] Add `onRetry` to the failed loads that lack Try again (A-10, B-07, C-04, D-15, D-18, E-14), wired to the query's `refetch`:
  - `IP/my-courses/route.tsx`;
  - `IP/my-courses_/$courseId/route.tsx` (not for NOT_FOUND);
  - `IP/earnings/-components/course-lines.tsx`, which also shows a failed "Load more";
  - `IPC/content-items/video-captions-dialog.tsx`, also adding `LoadingState` "Loading captions…";
  - `IPC/content-items/attach-lesson-video-dialog.tsx`'s loading, which gets "Loading the video…";
  - the submission review in `.../submissions/$userId.tsx`.

  **Video questions:** in `IPC/content-items/video-questions/video-questions-dialog.tsx` and `video-questions-editor.tsx`:
  - show "Loading the video…" while the player URL loads;
  - show an `ErrorAlert` with retry when it fails;
  - render "Add an end question" without the player.
- [x] T061 [P] [US7] Replace the hand-built "Retry" buttons with `ErrorAlert`'s `onRetry` (A-11, B-06):
  - `IP/index.tsx`;
  - `IP/dashboard/route.tsx`;
  - `IP/dashboard_/$courseId/route.tsx`;
  - `IP/dashboard_/$courseId/-components/quiz-panel.tsx`;
  - `IP/earnings/-components/payout-account-card.tsx`, `balance-card.tsx`, `report-section.tsx` and `payouts-list.tsx`;
  - `IP/profile.tsx`.

  The four tests that click "Retry" (`IP/-index.test.tsx`, `IP/dashboard/-route.test.tsx`, `IP/dashboard_/$courseId/-route.test.tsx`, `quiz-panel.test.tsx`) click "Try again" instead. Say so in the pull request.
- [ ] T062 [P] [US7] Make each failure show once with one retry (E-15):
  - **Reviews:** `IP/my-courses_/$courseId_/-components/reviews-screen.tsx` shows one `ErrorAlert` when the summary or the list fails, whose retry refetches both.
  - **Hand-rolled blocks:** `IP/my-courses_/$courseId_/questions/-components/paged-list.tsx`, `by-lesson-view.tsx` and `.../submissions/-components/submissions-table.tsx` switch their hand-rolled error blocks to `ErrorAlert` with `onRetry`.
- [ ] T063 [P] [US7] Tie validation to fields, and keep Save enabled (A-14, B-12, D-11, D-22, E-16). In each form:
  - Save is never `disabled` for an incomplete form;
  - on submit with problems, focus moves to the first invalid field;
  - each error has an `id` referenced by its field's `aria-describedby`, and the field has `aria-invalid`.

  The forms:
  - `packages/websites/instructor-portal/src/components/create-course-dialog.tsx`;
  - `IP/profile.tsx`, where the Handle's existing hint id stays in `aria-describedby` beside the error's;
  - `IPC/content-items/edit-lesson-text-dialog.tsx`, `attach-lesson-video-dialog.tsx` and `attach-lesson-file-dialog.tsx`;
  - `IPC/assignment/upload-assignment-fields.tsx`, with `create-assignment-dialog.tsx` and `edit-assignment-dialog.tsx`;
  - the Points field in `.../submissions/-components/grading-form.tsx`, whose error moves under the field;
  - the quiz builder's `showProblemsFirst` in `IPC/content-items/quiz/use-quiz-builder-state.ts`, which focuses the first problem's field and sets `aria-invalid` on invalid fields in `question-card.tsx`.

  **Tests:** in each form's test file.
- [ ] T064 [P] [US7] Fix the silent and hidden states:
  - **Wrong file type (D-12):** `IPC/content-items/attach-lesson-video-dialog.tsx` shows the dropzone's rejections as `attach-lesson-file-dialog.tsx` does.
  - **Caption removal (D-13):** `IPC/content-items/video-captions-dialog.tsx` renders the removal error inside the open `AlertDialogContent`.
  - **Processing videos (D-05):** `IPC/content-items/lesson-content-items-row.tsx` shows a "Processing…" or "Processing failed" badge from the item's status, and drops the `title` tooltip on the disabled Questions button.
  - **Draft announcements (C-12):** `IPC/announcements/announcements-section.tsx` shows "Publish the course to post announcements." instead of the form on a draft course.
  - **Delete permanently (C-20):** `IPC/course/archived-section.tsx` shows its disabled reason as text beside the button.
  - **Silent loads (C-20):**
    - the checklist's profile line (`IPC/course/landing-page-checklist.tsx`, through `IP/my-courses_/$courseId/route.tsx`) shows an inline error with Try again when `profile.get` fails;
    - so does the category select in `IPC/course/course-catalogue-form.tsx` when `category.listActive` fails.
  - **Deleting a lesson:** `IPC/lesson/delete-lesson-dialog.tsx` says how many items are deleted with the lesson in a draft.
- [x] T065 [P] [US7] Fix the My Courses empty states in `IP/my-courses/route.tsx` (B-08):
  - with no courses at all, show "You don't teach any courses yet" with Create course;
  - keep "No courses found" and Clear filters for a filter that hides every course.
- [ ] T066 [US7] Extend `packages/e2e/src/scenarios/phone-width.e2e.ts`'s instructor section, or add `packages/e2e/src/scenarios/instructor-errors.e2e.ts`. As a new instructor:
  - with `page.route` aborting the API, open `/my-courses`, the course editor and the quiz builder's Save. Assert no "Failed to fetch" text, and a "Try again" that recovers once the route is released;
  - open My Courses as a brand-new instructor and assert "You don't teach any courses yet";
  - on a draft course, assert the announcements line.

  Screenshots: `'my courses error with try again'`, `'new instructor my courses'`.
- [ ] T067 [US7] Run the instructor and student portals' and `common-shadcn`'s tests, lint, typecheck and build. Fix failures in the code.

---

## Phase 9: User Story 8 - Lists and views can be shared and come back to (Priority: P3)

**Goal**: My Courses' filter and search, the questions page's tab and lesson, and the earnings period live in the address.

**Independent test**: quickstart, US8.

- [ ] T068 [P] [US8] Test first in `IP/my-courses/-route.test.tsx`, then add `validateSearch` to `IP/my-courses/route.tsx` as [contracts/url-state.md](./contracts/url-state.md) says (B-09):
  - `status`: `all` | `published` | `draft` | `archived`, default `all`;
  - `q`: trimmed, at most 200 characters.

  The filter pushes, and the search box replaces (debounced as today). Defaults are left out, and invalid values fall back with `replace`.
- [ ] T069 [P] [US8] Test first in `IP/my-courses_/$courseId_/questions/-route.test.tsx`, then add `validateSearch` with `tab` (`unanswered` | `reported` | `by-lesson`) and `lesson` to `IP/my-courses_/$courseId_/questions/route.tsx` (E-10). The `Tabs` become controlled from `tab`, and `-components/by-lesson-view.tsx`'s select from `lesson`. A `lesson` not in the course shows By lesson with nothing chosen.
- [ ] T070 [P] [US8] Test first in `IP/earnings/-route.test.tsx`, then add `validateSearch` with `month` (`YYYY-MM`) or `from` and `to` (`YYYY-MM-DD`, `from` ≤ `to`) to `IP/earnings/route.tsx`, and drive `-components/period-picker.tsx` from it (A-21). If both are present the range wins. The report's request gets the same `from` and `to` the picker computes today.
- [ ] T071 [US8] Add `packages/e2e/src/scenarios/instructor-views.e2e.ts`. As a new instructor with draft and published courses:
  - filter My Courses to Draft, search, reload, and assert the same view. Go Back and assert "All";
  - open a course's questions on Reported, reload, and assert Reported;
  - open earnings, choose the previous month, reload, and assert that month.

  Screenshot: `'my courses filtered from the address'`.
- [ ] T072 [US8] Run the instructor portal's tests, lint, typecheck and build. Fix failures in the code.

---

## Phase 10: User Story 9 - Controls are big enough and say what they are (Priority: P3)

**Goal**: Every required control is at least 24px; checkboxes, radios and switches are one target with their text; names are unique and contain the visible text; dialogs have descriptions.

**Independent test**: quickstart, US9.

- [ ] T073 [US9] Test first, then make the shared controls at least 24px (B-17, A-16, C-15, D-19, E-19). Name the shadcn-file changes in the pull request.
  - **Dialog close:** in `SH/components/ui/dialog.tsx`, the close button becomes `size-6` with the 16px icon.
  - **Hit areas:** `SH/components/ui/checkbox.tsx` and `SH/components/ui/radio-group.tsx` get a 24px hit area (`relative after:absolute after:-inset-1 after:content-['']`). `SH/components/ui/switch.tsx` gets `after:-inset-y-0.5`. The visual size doesn't change.

  Run all three portals' tests.
- [ ] T074 [P] [US9] Make each control's text part of its target (A-16, C-15, D-19, E-17):
  - in `SH/components/notification-preferences.tsx`, each switch's name becomes a `Label htmlFor` (the switch keeps its description through `aria-describedby`);
  - in `IPC/content-items/quiz/quiz-settings-section.tsx` and `IPC/course/course-certificate-criteria.tsx`, each checkbox and its text sit in one `<label>` with no gap;
  - the grading form's Feedback label is tied to its editor through `aria-labelledby`.
- [ ] T075 [P] [US9] Give the short links and buttons a 24px minimum height (A-18, C-15):
  - "Show orders" in `IP/earnings/-components/report-section.tsx` (drop `h-auto p-0` or add `min-h-6`);
  - the tag Remove buttons in `IPC/course/course-catalogue-form.tsx`;
  - the Reviews and Questions links in `IP/my-courses_/$courseId/route.tsx`.
- [ ] T076 [P] [US9] Fix the accessible names (B-20, B-21, C-19, D-20). Change the existing assertions named in plan.md (`course-modules.test.tsx`, `lesson-content-items-row.test.tsx`, `packages/e2e/src/scenarios/video-questions.e2e.ts`), and say so in the pull request.
  - **Open course:** "Open course" links in `IP/my-courses/route.tsx` get `aria-label={`Open course: ${title}`}`.
  - **Module buttons:** in `IPC/course/course-modules.tsx` they are named by title ("Edit module <title>", "Remove module <title>").
  - **Questions button:** "Questions (N) for <title>" in `IPC/content-items/lesson-content-items-row.tsx`.
  - **Move buttons:** "Move up, question N" and "Move down, question N" in `IPC/content-items/video-questions/video-questions-editor.tsx`.
  - **Dashboard cards:** in `IP/dashboard/route.tsx`, each card's link is its title, stretched over the card (`after:absolute after:inset-0` on the link, `relative` on the card).
- [ ] T077 [P] [US9] Turn the intros of `IPC/content-items/edit-lesson-text-dialog.tsx`, `attach-lesson-video-dialog.tsx`, `attach-lesson-file-dialog.tsx` and `video-captions-dialog.tsx` into `DialogDescription` (D-21). **Test:** each dialog has `aria-describedby`.
- [ ] T078 [US9] Run the instructor, student and admin portals' and `common-shadcn`'s tests, lint, typecheck and build. Fix failures in the code.
- [ ] T079 [US9] (human) On the local stack, measure the controls listed in quickstart US9 at 375px and 1440px, and confirm that each switch's and checkbox's text toggles it. Note any control under 24px in the pull request.

---

## Phase 11: User Story 10 - The course editor's content is quick to reach (Priority: P3)

**Goal**: "Course content" comes first below the header, and a row of section links leads to every section, kept in the address.

**Independent test**: quickstart, US10.

- [ ] T080 [US10] Test first in `IP/my-courses_/$courseId/-route.test.tsx` (create it if absent), then reorder `IP/my-courses_/$courseId/route.tsx` (C-03, clarification). After the header card come, in order:
  1. "Course content";
  2. the settings sections (landing page, catalogue, captions, certificates, first-lesson prompt, price);
  3. announcements;
  4. archived.

  Give each section's heading the id in [data-model.md](./data-model.md) ("The course editor's sections") and `tabIndex={-1}`. **Test:** the order of the `h2`s.
- [ ] T081 [US10] Test first, then add `IPC/section-links.tsx`: a `nav` with `aria-label="Course sections"`.
  - **Links:** one router `Link to="." hash="<id>"` for each section present on the page, in the data-model's order and names. A section not on the page (archived course, no archived items, captions off) has no link.
  - **Row:** `flex gap-2 overflow-x-auto`.
  - **Hash changes:** focus the section's heading, and scroll with `behavior` from `prefers-reduced-motion`.

  Render it under the header in `route.tsx`. **Tests:**
  - the links' `href`s keep the course path;
  - an absent section has no link;
  - after a hash change the heading is focused.
- [ ] T082 [US10] Extend `packages/e2e/src/scenarios/phone-width.e2e.ts`'s course-editor case (from T014). Assert:
  - the "Course content" heading's top is within 812px of the header card's bottom;
  - the section links row doesn't make the page scroll sideways;
  - clicking "Announcements" scrolls to its heading, keeps the course path, and sets `#announcements`.

  Screenshot: `'course editor section links'`.
- [ ] T083 [US10] Run the instructor portal's tests, lint, typecheck and build. Fix failures in the code.

---

## Phase 12: User Story 11 - The rules are written down for the next change (Priority: P3)

**Goal**: The UI rules gain a check for every pattern this feature fixes.

**Independent test**: the new bullets are in `packages/websites/CLAUDE.md`; nothing is said twice.

- [ ] T084 [US11] Add the bullets in [contracts/ui-rules.md](./contracts/ui-rules.md) to `packages/websites/CLAUDE.md`, under the sections it names, and replace step 4 of "Check every changed screen this way".
  - **Before the pieces exist:** where a rule names a piece that isn't merged yet (`PendingButton`, `useDiscardGuard`, `useUnsavedChangesGuard`, `StatusMessage`, `expectOnScreen`, `expectDialogFits`), write it as merged. This phase merges after Phase 1, which adds the shared pieces, except `useDiscardGuard` and `useUnsavedChangesGuard`.
  - **Before Phase 7:** if Phase 7 has not merged, word those two rules without the hook names ("asks before discarding"), and add the names in Phase 7's pull request.
- [ ] T085 [US11] Read the changed file against the root `CLAUDE.md`, `packages/common/shadcn/CLAUDE.md` and `.specify/memory/constitution.md`, and remove anything said twice or contradicted (FR-034). Run `pnpm lint` and `graphify update .`.
- [ ] T086 [US11] (human) Start a fresh agent session in `packages/websites/instructor-portal`. Ask it to add an edit dialog with a Save button, and a row with a title and four controls. Review the result against the rules, and note in the pull request any defect the rules should have prevented.

---

## Phase 13: Polish - the whole portal, by hand

**Goal**: Confirm on a running stack what tests cannot.

- [ ] T087 (human) With all phases merged, walk [quickstart.md](./quickstart.md) at 375px and 1440px on the local stack, saving screenshots to `tmp/screenshots/pr-<number>/`. Compare the network panel with `main` on the course editor, a submission and earnings: the same requests, in the same order (FR-031).
- [ ] T088 (human) On a real phone, or the browser's device mode with touch:
  - rename a lesson, hide it, save a quiz edit, and grade a submission. Confirm nothing needs a sideways scroll or a zoom to reach (SC-003);
  - at 1440px with the browser's text zoom at 200%, confirm that the course editor and a dialog still don't scroll sideways.
- [ ] T089 Record in `spec.md`'s Assumptions, as a dated note, anything the walk found that this spec left out of scope, so that the next audit starts from it. Do not widen this feature.

---

## Dependencies

- **Phase 1 first.**
  - Phases 2 to 12 use its pieces: Phases 5, 6, 8 and 10 use `PendingButton`, `useReturnFocus`, `StatusMessage` and `LoadingState`; Phases 2, 4 and 11 use the e2e helpers.
  - Phase 2 (US1) adds the instructor section of `phone-width.e2e.ts`, which Phases 4, 8 and 11 extend.
- **Files several phases touch.** These touch the same files; whichever merges second rebases:
  - **US1 and US10:** Phase 2 and Phase 11 both edit `course-modules.tsx` and the editor's `route.tsx`. Merge 2 first.
  - **US4 and US7:** Phase 5 and Phase 8 both edit the error branches of the analytics, course editor and submission routes. Merge 5 first.
  - **US5 and US6:** Phase 6 and Phase 7 both edit the quiz builder and video-questions dialogs (T044, T051).
  - **US1 and US9:** Phase 2 (T007) and Phase 10 (T073) both edit `ui/dialog.tsx`.
- **Phase 12 (US11)** may merge any time after Phase 1; T084 says how to word rules whose pieces aren't merged yet.
- **Within a phase,** tasks marked [P] touch different files.

## Requirement coverage

| Requirement | Tasks |
|-------------|-------|
| FR-001 no sideways scroll or clipping | T007, T008, T009, T010, T011, T012, T013, T014, T023, T026, T027, T028, T030 |
| FR-002 title-and-controls rows wrap | T008, T009, T012, T014 |
| FR-003 dialog footers wrap | T010, T014 |
| FR-004 cut titles readable | T023, T025 |
| FR-005 nothing only on hover | T023, T064 |
| FR-006 course cards | T025 |
| FR-007 charts and tables | T024, T029 |
| FR-008 in-page and in-app links | T019, T021, T081 |
| FR-009 breadcrumbs | T016, T017, T021 |
| FR-010 not-found page | T018, T021 |
| FR-011 no dead control | T020 |
| FR-012 title, one h1, one main, focus on navigation | T032, T033, T034, T035, T036, T038 |
| FR-013 busy controls keep focus | T001, T041, T047 |
| FR-014 focus after removal or swap | T042, T043, T044, T046, T047, T048 |
| FR-015 focus after closing | T002, T040, T043, T044, T046 |
| FR-016 reorder focus and announcement | T042, T044, T048 |
| FR-017 results announced once | T003, T041, T043, T045, T046 |
| FR-018 failed save keeps input | T053, T057 |
| FR-019 Cancel resets; dismissal asks | T051, T054, T055, T057 |
| FR-020 leaving the editor asks | T052, T056, T057 |
| FR-021 error sentences | T059, T066 |
| FR-022 one Try again; errors where you look | T060, T061, T062, T064, T066 |
| FR-023 problems and reasons in words | T063, T064 |
| FR-024 content first, section links | T080, T081, T082 |
| FR-025 waits in words | T004, T037, T041 |
| FR-026 empty lists say why | T065, T066 |
| FR-027 views in the address | T068, T069, T070, T071 |
| FR-028 24px targets, one target with text | T073, T074, T075, T079 |
| FR-029 names | T019, T076 |
| FR-030 dialog title, description, first focus | T045, T077 |
| FR-031 no request changes | the rules for every task; T087 |
| FR-032 text-only buttons | the rules for every task |
| FR-033 shared fixes in shared packages | T007, T016, T026, T032, T040, T051, T052, T059, T073, T074; other portals' tests in T015, T022, T031, T039, T049, T058, T067, T078 |
| FR-034 rules written down | T084, T085, T086 |
| FR-035 e2e fails on overflow and clipped controls | T005, T014, T030, T082 |

The 200% zoom edge case and SC-003 (a phone task start to finish) are checked by hand in T088. SC-012 (the rules can be checked in 15 minutes) is checked in T086.

## Parallel example

After Phase 2 merges, four agents can work at once, touching different files:

- **Phase 3 (US2):** the shell and the checklist.
- **Phase 4 (US3):** analytics, cards, reviews and the submission.
- **Phase 9 (US8):** the three routes' search params.
- **Phase 12 (US11):** the rules.

## Implementation strategy

- **First, the P1 slice: Phases 1 to 4.** These fix what stops an instructor using the portal on a phone, or sends them to a broken page. Ship them first.
- **Next, Phases 5 to 8.** These make the portal usable with a keyboard and a screen reader, and stop work being lost.
- **Last, Phases 9 to 12,** which are polish and prevention. Phase 13 is the final walk.
