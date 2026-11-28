---

description: "Task list for the student portal UX fixes"
---

# Tasks: Student Portal UX Fixes

**Input**: Design documents from `/specs/20261121-133515-student-portal-ux-fixes/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The Discava constitution (principle IV) requires tests, so they're included: component tests for each shared piece and each changed page, unit tests for the two helpers, and e2e scenarios (a new phone-width one, and extensions to `learn`, `quiz`, `search` and `public-landing-page`). The feature writes no shared record, so there is no invariant work. Write each phase's tests first and watch them fail. Never weaken an existing test to make it pass; the four expectations this feature changes on purpose are named in T022, T024, T036 and T041, and the pull request says so.

**Who runs what**: An automated agent implements these tasks without `pnpm dev` or Docker. It runs unit and component tests, lint, typecheck and `build` locally. The agent writes the e2e tests, but PR CI runs them (`pr-checks.yml`'s `E2E tests` job); a CI failure is the feedback for those. Tasks marked **(human)** need a running local stack or people (a screen reader, a real phone), and a reviewer does them before merging.

**Organization**: Eleven phases. Each is one agent pull request and leaves `main` green, except that Phases 1 and 2 form the first one (the first story's phase ends the first implementation issue). Phases 3 to 10 depend only on Phase 1 and can merge in any order, with two exceptions that touch the same files: Phase 5 after Phase 2's `ResponsivePanel` use is merged, and Phase 9 after Phase 5. Paths are relative to the repository root. There is no parent issue: pull requests say "Part of the student portal UX fixes spec" and link `spec.md`.

| Label | Story | Priority |
|-------|-------|----------|
| US1 | A lesson fits the screen | P1 |
| US2 | Links on a page stay on that page | P1 |
| US3 | Search works on a phone | P1 |
| US4 | Filters do not get in the way | P2 |
| US5 | A quiz can be taken with a keyboard or a screen reader | P2 |
| US6 | Errors say what to do next | P2 |
| US7 | Every page says where you are | P2 |
| US8 | Course cards and profiles read cleanly | P3 |
| US9 | The rules are written down for the next change | P3 |

**Rules for every task**: no request the portal makes may change (FR-028): do not add, remove or reorder a query or mutation, or change an input. Buttons carry text only, no arrow icons. A fix to a shared component is made in `packages/common/shadcn` or `packages/common/web-utils`, not overridden in the portal. Every e2e task that changes what a user sees calls `screenshot()` on the changed screen.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)

---

## Phase 1: Foundational - the shared panel and the phone-width check

**Goal**: The one component the outline and the filters both need, and the e2e helper every layout story asserts with. Nothing users see changes.

**Independent test**: `pnpm nx run @discava/common-shadcn:test -- --run responsive-panel` passes.

- [x] T001 [P] Test first, then add `ResponsivePanel` to `packages/common/shadcn/src/components/responsive-panel.tsx`, as [contracts/shared-components.md](./contracts/shared-components.md) and research R-11 describe: props `label: string`, `summary?: ReactNode`, `children`, `className?`. It composes the existing `Collapsible` from `./ui/collapsible`, starting closed. The trigger is a full-width outline `Button` showing `label`, then `summary` (truncating, `min-w-0`), then a `ChevronDown` (`aria-hidden`, rotating when open); it carries `lg:hidden`. The content carries `lg:!block` so it always shows at the `lg` breakpoint and above. No width is measured and `useIsMobile` is not used. Tests in `responsive-panel.test.tsx`:
  - the trigger has `aria-expanded="false"` at first and `"true"` after a click, and names `label`;
  - the children are in the document after opening;
  - `summary` renders beside the label;
  - the trigger has the class that hides it at `lg`, and the content the class that shows it at `lg` (assert the class names: jsdom has no layout).
- [x] T002 [P] Add `packages/e2e/src/helpers/viewport.ts` exporting `PHONE = { width: 375, height: 812 }` and `expectNoSidewaysScroll(page)`, which asserts with `expect.poll` that `document.documentElement.scrollWidth` is not greater than `document.documentElement.clientWidth`, and on failure names the widest elements (the first five whose `getBoundingClientRect().right` exceeds `innerWidth`) in the assertion message.
- [x] T003 Run `pnpm nx run @discava/common-shadcn:test` (once), lint and typecheck for `common-shadcn` and `e2e`, and fix failures in the code, not the tests.

---

## Phase 2: User Story 1 - A lesson fits the screen (Priority: P1) 🎯 MVP

**Goal**: The lesson and course-home pages have no sideways scroll at 375px, the lesson column is the wide one at 1440px, and on a phone the outline is closed above the lesson.

**Independent test**: quickstart steps 5 to 7.

- [x] T004 [US1] Tests first in `packages/websites/student-portal/src/routes/learn/$courseId/-components/course-home-and-lesson-page.test.tsx`, then change `CoursePlayerLayout` in `course-player.tsx` (research R-1): the grid becomes `lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]`; the `aside` gains `min-w-0`; the outline is wrapped in `ResponsivePanel` with `label="Course outline"` and `summary` set to the active lesson's title (on the course home, where there is no active lesson, `summary` is the count of lessons, e.g. "3 lessons"). The `aside` keeps `lg:sticky lg:top-20 lg:h-fit`. Tests:
  - a "Course outline" button exists with `aria-expanded="false"` and shows the active lesson's title;
  - after clicking it, the outline's links are present and the active lesson has `aria-current="page"`;
  - the existing outline assertions still pass (open the panel first where a test reads the outline; that is the behaviour change of FR-003, not a weakened test, and the pull request says so).
- [x] T005 [P] [US1] In `packages/websites/student-portal/src/routes/learn/$courseId/-components/lesson-page.tsx` and `course-player.tsx`, give every flex or grid child that holds truncating or user-written text `min-w-0`, and long unbroken text `break-words`: the lesson `h2`, the "Module N: title" line, the course `h1`, item titles in `content-item.tsx`. Add a component test that renders a lesson whose titles are 90-character words with no spaces and asserts those elements carry `break-words` (or `truncate` with `min-w-0` on the parent).
- [x] T006 [US1] Create `packages/e2e/src/scenarios/phone-width.e2e.ts` with `test.use({ viewport: PHONE })`. It makes its own instructor-student (`newUser('Ivy', ['instructor', 'student'])`), a course through `createPublishedCourseViaApi`-style calls in `helpers/api.ts` (add an optional `titles` argument or a new helper `createLongTitledCourseViaApi` there) whose course, module and lesson titles are each over 60 characters, enrols through the page and lands on the first lesson. Assert: `expectNoSidewaysScroll`; the "Course outline" button is visible and collapsed; the lesson's `h2` and the "You're enrolled" notice are within the first 812px (`boundingBox().y + height <= 812`); opening the outline and choosing the second lesson opens it. `screenshot(page, 'lesson at phone width')` and `'outline open at phone width'`.
- [x] T007 [US1] Extend `packages/e2e/src/scenarios/learn.e2e.ts` (desktop): on a lesson of a course with 60-character module titles (reuse T006's helper), the lesson `section`'s width is at least 1.8 times the outline `aside`'s (SC-003). `screenshot(page, 'lesson columns at desktop width')`.
- [x] T008 [US1] Run `pnpm nx run @discava/student-portal:test` (once), lint, typecheck and `pnpm nx run @discava/student-portal:build`; fix failures in the code.

---

## Phase 3: User Story 2 - Links on a page stay on that page (Priority: P1)

**Goal**: Every in-page link leads to its section of the same page, also in a new tab; a wide tab bar scrolls by itself; no link is dead.

**Independent test**: quickstart steps 8 to 11.

- [x] T009 [US2] Tests first in `packages/websites/student-portal/src/routes/learn/$courseId/-components/course-page.test.tsx`, then in `course-page.tsx` replace the section tab bar's `<a href={`#${id}`}>` and the "N modules" card's `<a href="#modules">` with the router's `Link` to the current route (`to="/learn/$courseId"`, `params={{ courseId }}`, `hash={id}`), keeping their classes (research R-2). Give the tab bar's inner row `overflow-x-auto` and its links `shrink-0 whitespace-nowrap` (FR-007). Tests: each tab's `href` is `/learn/<courseId>#<id>` (not `/#<id>`); the modules card's is `/learn/<courseId>#modules`; with all six sections present the row has the scrolling class.
- [x] T010 [P] [US2] Tests first in `course-home-and-lesson-page.test.tsx`, then in `lesson-page.tsx`'s `Step`: build the link with `Link` (`to="/learn/$courseId/lesson/$lessonId"`, the item's `courseId` and `lessonId`, `hash={itemAnchor(item.contentItemId)}`) so its `href` is the lesson's address with the fragment. Keep the click handler that scrolls, but pass `behavior: 'auto'` when `window.matchMedia('(prefers-reduced-motion: reduce)').matches` and `'smooth'` otherwise, and after scrolling call `focus({ preventScroll: true })` on the target `article`, which gets `tabIndex={-1}` in `content-item.tsx` (FR-013). Tests: the `href`; with `matchMedia` stubbed to match, `scrollIntoView` is called with `behavior: 'auto'`; after a click the item's `article` is `document.activeElement`.
- [x] T011 [P] [US2] In `packages/websites/student-portal/src/routes/-components/catalogue.tsx`: remove the footer's "Terms" link (FR-009; there is no terms page) and remove `id="terms"` from the footer; make "About" a `Link` with `to="/"` and `hash="features"`. Add or extend the catalogue's component test: no link named "Terms"; "About"'s `href` is `/#features`.
- [x] T012 [US2] Extend `packages/e2e/src/scenarios/public-landing-page.e2e.ts`: on a published course's page, clicking each section tab and the "N modules" card leaves `page.url()` starting with the course's address and ending in `#<section>`, and the section's heading is in the viewport below the sticky bars. `screenshot(page, 'course page after choosing Modules')`. In `phone-width.e2e.ts` add: a course with learning outcomes, requirements and an instructor (six tabs) passes `expectNoSidewaysScroll` on its page, and the last tab can be scrolled into view and clicked.
- [x] T013 [US2] Run `pnpm nx run @discava/student-portal:test` (once), lint and typecheck; fix failures in the code.

---

## Phase 4: User Story 3 - Search works on a phone (Priority: P1)

**Goal**: At 375px the top bar fits for every signed-in user, the search box shows what is typed, and suggestions are readable.

**Independent test**: quickstart steps 12 to 14.

- [x] T014 [US3] Tests first (new `packages/websites/student-portal/src/components/site-layout.test.tsx` if none exists, using `createRenderWithApi` and `mockRouter` from `@discava/common-web-utils/testing`), then in `site-layout.tsx` (research R-3): wrap the "Instructor" and "My Learning" buttons in a `hidden sm:flex` group; pass `UserMenu` an `items` array with "My Learning" (to `/my-learning`) first and, for an instructor, "Instructor" (the instructor portal's `/my-courses`), each marked to show only below `sm`. If `UserMenuItem` has no way to hide an entry by breakpoint, add an optional `className` to it in `packages/common/shadcn/src/components/user-menu.tsx` (with a test there) and pass `sm:hidden`. Nothing else in the bar changes. Tests: for an instructor-student both entries are in the user menu after opening it, in that order, and both buttons carry the class that hides them below `sm`; for a student who is not an instructor only "My Learning" is there.
- [x] T015 [P] [US3] Tests first in the existing site-search test (or a new `site-search.test.tsx`), then in `packages/websites/student-portal/src/components/site-search-suggestions.tsx`: the list's container becomes `fixed inset-x-4 top-16 sm:absolute sm:inset-x-0 sm:top-full` (keeping `mt-2`, `z-50` and its other classes; drop `max-w-[calc(100vw-2rem)]`), and each suggestion's title uses `line-clamp-2 break-words` in place of `truncate`. Replace the straight quotes in "See all results for '…'" with curly ones. Tests: a suggestion's title element has `line-clamp-2`; the container has the `fixed` and `sm:absolute` classes; the last option reads `See all results for ‘typ’`.
- [x] T016 [US3] In `phone-width.e2e.ts` add, as the instructor-student: on the home page `expectNoSidewaysScroll`; the user-menu button's bounding box lies within the viewport; typing the first 20 characters of the course's title leaves the search input at least 150px wide; the suggestions listbox is visible and at least 320px wide; opening the user menu shows "My Learning" then "Instructor". `screenshot(page, 'search suggestions at phone width')` and `'user menu at phone width'`. In an existing desktop scenario that already loads a signed-in page (for example `my-learning.e2e.ts`), assert the "My Learning" button is still visible in the top bar.
- [x] T017 [US3] Run `pnpm nx run @discava/student-portal:test` and `pnpm nx run @discava/common-shadcn:test` (once each), lint and typecheck; fix failures in the code.

---

## Phase 5: User Story 4 - Filters do not get in the way (Priority: P2)

**Goal**: On a phone the courses come first; changing a filter keeps the panel and the keyboard's place; a filter row is one target.

**Independent test**: quickstart steps 15 to 19.

- [x] T018 [US4] Tests first (extend the catalogue results test, or add `packages/websites/student-portal/src/components/catalogue-results.test.tsx` with `fakeTrpcFetch`), then in `catalogue-results.tsx` (research R-4): add `placeholderData: keepPreviousData` to the `course.publicSearch` infinite query options, changing nothing else in them; while `searchQuery.isPlaceholderData`, put `aria-busy="true"` and `opacity-60` on the results column; wrap `CatalogueFilterPanel` in `ResponsivePanel` with `label="Filters"` and `summary` reading "N active" when N filters are set (count categories, levels, languages, durations, tags, a minimum rating and a non-default sort) and nothing when none are. Tests:
  - after a filter change, while the second response is pending, the filter panel is still in the document and the results region has `aria-busy="true"`;
  - a checkbox focused before the change is `document.activeElement` after the second response arrives;
  - the request made after the change has the same input as it has on `main` for those filters (assert the fake fetch's recorded input);
  - with two filters set the trigger reads "Filters" and "2 active".
- [x] T019 [P] [US4] Tests first, then in `packages/websites/student-portal/src/components/catalogue-filters.tsx`'s `Group`: make each row one `Label` that wraps the `Checkbox`, the text and the count (`flex min-h-6 cursor-pointer items-center gap-2 py-1`), dropping the separate `div` and `htmlFor` pairing but keeping the checkbox's `id` (`filter-<name>-<value>`, which T018's focus test relies on). Tests: clicking the count toggles the checkbox; the checkbox's accessible name is still the option's label and count.
- [x] T020 [P] [US4] Tests first, then in `packages/websites/student-portal/src/routes/category/$slug.tsx`: keep the search box in step with the address by resetting `text` when `query` changes (an effect on `query`, or a `key={query}` on the form), and give the input `name="query"` and `autoComplete="off"` (FR-023). In `routes/search/index.tsx` add `break-words` to the results `h1` (US4 scenario 6). Tests: rendering the category route with `?query=abc` then navigating to the same route without it empties the box; the search page's `h1` has `break-words`.
- [x] T021 [US4] In `phone-width.e2e.ts` add, with a course that has a category, level, language, duration and tags (extend the helper from T006 to call `course.updateCatalogue`, and make the category through the admin API as a new admin user): on the home page, a search for the course's title and the category page, the first course card's top is within 812px, `expectNoSidewaysScroll`, and "Filters" is collapsed; a search for a 70-character word with no spaces passes `expectNoSidewaysScroll`. `screenshot(page, 'search results at phone width')` and `'filters open at phone width'`. Extend `search.e2e.ts` (desktop): focus a filter checkbox, press Space, wait for the results to update, and assert the same checkbox is focused and checked; press Tab and Space and assert the next one is checked.
- [x] T022 [US4] Run `pnpm nx run @discava/student-portal:test` (once), lint and typecheck; fix failures in the code. If an existing test or e2e helper finds a filter by the old `div`/`label` structure, update the locator to find it by role and name, and say so in the pull request.

---

## Phase 6: User Story 5 - A quiz can be taken with a keyboard or a screen reader (Priority: P2)

**Goal**: Focus follows the quiz's phases, the result is announced, the navigator is numbered and large enough, and the review says what submitting costs.

**Independent test**: quickstart steps 20 to 23.

- [x] T023 [US5] Tests first in `packages/common/shadcn/src/components/quiz-card.test.tsx`, then in `quiz-card.tsx` (research R-5, [data-model.md](./data-model.md)): keep a ref on the card's content wrapper; in an effect keyed on `phase.name` and the question index, skipping the first render, focus the element marked `data-quiz-focus` inside it. Mark, each with `tabIndex={-1}` and `outline-none`: the "Question N of M" line in `quiz-question-screen.tsx`, the review's "N of M questions answered" line, the result's "This attempt: …" line and the overview's first summary line in `quiz-card-phases.tsx`. Wrap the result's score line in an element with `role="status"`. Tests, driving the card with `userEvent`:
  - rendering the card moves focus nowhere;
  - Start quiz, Next, Back, a navigator button, Review answers, Change, Submit (resolved as `submitted`), Done and Retake each leave `document.activeElement` on the new phase's marked line;
  - a submission resolved as `error` keeps the phase, shows the alert (`role="alert"`) and keeps the answers;
  - `updated` followed by new questions focuses the review's line;
  - the score line is inside a `role="status"` element.
- [x] T024 [US5] Tests first in `quiz-card.test.tsx`, then in `packages/common/shadcn/src/components/quiz-card-phases.tsx`:
  - the navigator's buttons become `size-6` with the question's number as visible text (`text-xs font-medium tabular-nums`); they keep `aria-current="step"`, the answered fill and today's `aria-label` ("Question N", then ", answered" and the marker where they apply), which contains the visible number; do not render the navigator when there is one question (FR-017);
  - `ReviewPhase` takes `attemptNumber: number` and `attemptsAllowed: number | null` from `QuizCard` (`draft.attemptNumber`, `settings.attemptsAllowed`); when `attemptsAllowed` is not null it shows "This uses attempt N of M." above the buttons; its button reads "Submit answers" and "Submitting…" (FR-019).

  Tests: three numbered buttons for three questions and none for one; the attempt line for a two-attempt quiz and its absence for unlimited attempts; the button's name. This changes one existing expectation on purpose: tests and the e2e helper `takeQuiz` in `packages/e2e/src/helpers/student-portal.ts` that click "Submit" now click "Submit answers" (FR-019). Update them and say so in the pull request.
- [x] T025 [P] [US5] Test first, then in `packages/common/shadcn/src/components/quiz-result-questions.tsx`: give the tick and its empty placeholder `shrink-0`, the option row `items-start` with the icon nudged to the first line (`mt-0.5`), and "(your answer)" `shrink-0 whitespace-nowrap` (FR-022). Test: with a 200-character option, the tick has `shrink-0`.
- [x] T026 [US5] Extend `packages/e2e/src/scenarios/quiz.e2e.ts` with a keyboard-only attempt on a three-question, two-attempt quiz (add the questions through the API helper): focus "Start quiz", press Enter, and after each of Start, Review answers, Submit answers and Done assert `document.activeElement` is inside the quiz's article and is not `body`; assert the review shows "This uses attempt 1 of 2."; assert the navigator has buttons named "Question 1", "Question 2", "Question 3" each at least 24px square. `screenshot(page, 'quiz question with numbered navigator')` and `'quiz review with attempt line'`.
- [x] T027 [US5] Run `pnpm nx run @discava/common-shadcn:test`, `pnpm nx run @discava/student-portal:test` and `pnpm nx run @discava/instructor-portal:test` (once each; the instructor portal previews quizzes with the same card), lint and typecheck; fix failures in the code.
- [ ] T028 [US5] (human) With a screen reader (VoiceOver or NVDA) on the local stack, take the quiz as quickstart steps 20 to 23 describe: each phase is read when it appears, and the score and "Passed" or "Not passed" are read after submitting. Also open the instructor portal's quiz preview and confirm the same.

---

## Phase 7: User Story 6 - Errors say what to do next (Priority: P2)

**Goal**: Network and server faults read as sentences with a next step, and failed loads offer "Try again".

**Independent test**: quickstart step 24.

- [x] T029 [P] [US6] Tests first in `packages/common/web-utils/src/api-errors.test.ts`, then change `apiErrorMessage` in `api-errors.ts` exactly as the table in [contracts/shared-components.md](./contracts/shared-components.md) says (research R-6): a request with no answer gives "Couldn't reach Discava. Check your connection and try again."; `INTERNAL_SERVER_ERROR` gives "Something went wrong on our side. Try again in a moment." whatever its message, and joins `MESSAGES`; everything else is unchanged. Tests: an error with message "Failed to fetch" and no `data`; "Load failed"; "NetworkError when attempting to fetch resource."; an error whose `cause` is a `TypeError`; `{ message: 'Output validation failed', data: { code: 'INTERNAL_SERVER_ERROR' } }`; and that every existing case in the file still passes unchanged (a written `PRECONDITION_FAILED` message is still shown as written).
- [x] T030 [P] [US6] Tests first in `packages/common/shadcn/src/components/error-alert.test.tsx`, then add `onRetry?: () => void` and `retryLabel?: string` (default "Try again") to `ErrorAlert` in `error-alert.tsx`: with `onRetry`, a small outline `Button` (`type="button"`, `className="mt-3"`) under the message calls it. Tests: no button without `onRetry` (the existing snapshot or assertions unchanged); the button's name and that a click calls `onRetry` once.
- [x] T031 [US6] Tests first in the files beside each component, then use the two pieces in the student portal, changing no query:
  - `routes/learn/$courseId/-components/enrolment-actions.tsx`: `enrolErrorMessage`'s last branch becomes `apiErrorMessage(error)` (its `NOT_FOUND` and `PRECONDITION_FAILED` branches stay); the "Couldn't check your enrolment" alert gets `onRetry={() => enrolmentQuery.refetch()}`;
  - `quiz-item.tsx`: the load error becomes `apiErrorMessage(quizQuery.error ?? attemptsQuery.error)` with `onRetry` refetching whichever of the two queries failed; in `onSubmit` the `default` branch's and the `PRECONDITION_FAILED` branch's `message` go through `apiErrorMessage(error)`;
  - `course-player.tsx`'s `Unavailable`: the generic branch uses `apiErrorMessage(error)` and takes an optional `onRetry`, which `CoursePlayerLayout` and `start-course.tsx` pass from the hook (expose the course query's `refetch` from `hooks/use-course-player.ts` as `retry` if it is not already returned; this adds a field to the hook's result, not a request);
  - `course-page.tsx`: the "Couldn't load this course" alert gets `onRetry={() => courseQuery.refetch()}`;
  - `content-item.tsx`: the video's "Couldn't load this video" alert gets `onRetry={() => videoQuery.refetch()}`;
  - `routes/-components/signed-in-home.tsx`: both alerts get `onRetry` with their query's `refetch`;
  - `components/catalogue-results.tsx`, `routes/category/$slug.tsx`, `routes/instructors/$handle.tsx`: replace the hand-built "Try again" `Button` inside `ErrorAlert` with the `onRetry` prop.

  Tests (with `fakeTrpcFetch` failing once, then succeeding): each of the lesson, quiz, course page and signed-in home shows "Couldn't reach Discava. Check your connection and try again." for a rejected fetch, never "Failed to fetch"; pressing "Try again" repeats the same request (same path and input) and the content replaces the error; after a failed enrolment the "Enrol now" button is enabled.
- [x] T032 [US6] Extend `packages/e2e/src/scenarios/learn.e2e.ts`: with `page.route` aborting `**/quiz.view*` once, the quiz shows the connection sentence and "Try again"; remove the route, press it, and the quiz's "Start quiz" appears without a reload. `screenshot(page, 'quiz load error with Try again')`.
- [x] T033 [US6] Run `pnpm nx run @discava/common-web-utils:test`, `pnpm nx run @discava/common-shadcn:test` and the three portals' tests (once each; `apiErrorMessage` and `ErrorAlert` are used by all three), lint and typecheck; fix failures in the code. A portal test that asserted the text "Failed to fetch" or "Output validation failed" was asserting the defect: update it to the new sentence and say so in the pull request.

---

## Phase 8: User Story 7 - Every page says where you are (Priority: P2)

**Goal**: Each page has its own title and one main heading, and following a link moves focus to it.

**Independent test**: quickstart steps 25 to 27.

- [x] T034 [P] [US7] Tests first, then add `packages/common/web-utils/src/page-title.ts` exporting `pageTitle(...parts)` (drops `undefined`, `null`, `false` and empty strings; appends `Config.applicationName` from `./app-config`; joins with " · ") and `packages/common/shadcn/src/hooks/use-page-title.ts` exporting `usePageTitle(...parts)`, which sets `document.title` in an effect and restores nothing on unmount (research R-7). Register the new module in `common-web-utils`'s package exports as the other per-module files are. Tests: `pageTitle('Projections', 'Linear Algebra')` is `"Projections · Linear Algebra · Discava"`; `pageTitle()` and `pageTitle(undefined, '')` are `"Discava"`; the hook updates the title when its parts change.
- [x] T035 [P] [US7] Tests first, then add `RouteAnnouncer` to `packages/common/shadcn/src/components/route-announcer.tsx` as [contracts/shared-components.md](./contracts/shared-components.md) says: props `containerId` and `pathname`; renders nothing; on a change of `pathname` after the first render it focuses the first `h1` inside the container (setting `tabIndex={-1}` and a class that removes the outline on that programmatic focus), waiting for it with a `MutationObserver` that it disconnects on the next change, on unmount, or after 5 seconds. It never writes `document.title` (research R-7). Tests: nothing is focused on first render; after `pathname` changes and an `h1` is added later, that `h1` is focused; rendered as the parent of a child that calls `usePageTitle('Child')`, a `pathname` change that remounts the child leaves `document.title` as `Child · Discava`, and so does one where the child's parts are unchanged (the cached-query and fixed-title cases); a rerender with the same `pathname` focuses nothing; the observer is disconnected on unmount.
- [x] T036 [US7] Tests first in each route's test file, then in the student portal: mount `<RouteAnnouncer containerId={MAIN_CONTENT_ID} pathname={…} />` in `components/site-layout.tsx`, taking the pathname from `useRouterState({ select: (s) => s.location.pathname })`; call `usePageTitle` in every route with the parts in [contracts/page-titles.md](./contracts/page-titles.md) (`routes/index.tsx` or its two home components, `search/index.tsx`, `category/$slug.tsx`, `instructors/$handle.tsx`, `learn/$courseId/-components/course-page.tsx`, `start-course.tsx`, `course-home.tsx`, `lesson-page.tsx`, `my-learning/index.tsx`, `certificates/$certificateId/index.tsx` and `linkedin.tsx`, `settings/notifications.tsx`, `signin/index.tsx`, `unsubscribe.tsx`); remove the `document.title` effect from `instructors/$handle.tsx`. This changes one existing expectation on purpose: `routes/instructors/-instructor-profile.test.tsx`'s "sets the document title to the display name" expects `'Gil Strang'` and now expects `'Gil Strang · Discava'` (FR-011); update it and say so in the pull request. Cut a search query longer than 60 characters to 60 with "…" in the title. Tests: one per audited route asserting `document.title` when loaded and while loading or failed, as the contract's two columns say; a lesson the course no longer lists has the course's title only; and one test that renders the real `SiteLayout` around a route, navigates to a second route with a fixed title (My Learning) and back to the first, and asserts the title after each navigation (the case a route's own test cannot see).
- [x] T037 [P] [US7] Tests first, then fix the headings (FR-012): in `routes/-components/catalogue.tsx` the first heading ("Browse courses for every goal.") becomes the page's `h1`, keeping its classes; in `routes/learn/$courseId/-components/lesson-page.tsx` and `course-player.tsx` keep the course title as the `h1` and make sure the lesson's `h2`, each item's `h3` and the "removed" message's `h2` follow without a skipped level; in `components/catalogue-results.tsx` the empty state's `h3` becomes an `h2`; in `routes/signin/index.tsx` render the spinner inside `<main>` with an `h1` that is visually the status line "Signing you in…" (`role="status"` is on the wrapper, the spinner is `aria-hidden`) (FR-027, US7 scenario 6); the three other whole-page spinners (`course-page.tsx`'s loading state, `CoursePlayerLayout`'s in `course-player.tsx`, `signed-in-home.tsx`'s) get the visible text "Loading…" beside the spinner, as `start-course.tsx` already has "Opening your course…", with `role="status"` on the wrapper and the spinner `aria-hidden` (FR-027). Tests: each of these pages has exactly one `h1` (`getAllByRole('heading', { level: 1 })` has length 1) the sign-in page shows "Signing you in…", and each whole-page loading state shows "Loading…".
- [x] T038 [US7] Extend `packages/e2e/src/scenarios/learn.e2e.ts`: after opening a course from a search and then a lesson, `page.title()` matches the contract at each step, and after `page.goBack()` it is the previous page's; after following a link to the course page, `document.activeElement` is the `h1`. `screenshot()` is not needed: nothing visible changes.
- [x] T039 [US7] Run `pnpm nx run @discava/common-web-utils:test`, `pnpm nx run @discava/common-shadcn:test` and `pnpm nx run @discava/student-portal:test` (once each), lint, typecheck and build; fix failures in the code.
- [x] T040 [US7] (human) With a screen reader on the local stack, follow links from the home page to a search, a course and a lesson: the new page's name is read each time, and Back reads the previous page's. Confirm that changing a filter or choosing a course-page section tab does not move focus to the heading.

---

## Phase 9: User Story 8 - Course cards and profiles read cleanly (Priority: P3)

**Goal**: Cards of a modest, similar height whose title and picture open the course; the instructor profile as designed.

**Independent test**: quickstart steps 28 to 30.

- [x] T041 [US8] Tests first (the course card's test file, or a new `packages/websites/student-portal/src/components/course-card.test.tsx`), then in `course-card.tsx`: the description gets `line-clamp-3`; the title gets `leading-snug` and becomes the card's link (`Link` to `/learn/$courseId`) with an `after:absolute after:inset-0` overlay on a `relative` card so the picture and the whole card open the course; the "Learn more" text stays as visible text inside the same link or as a non-interactive label, so the card has exactly one link; the link has no `aria-label` that replaces its text (its name is the course's title, optionally followed by "Learn more") (FR-020, FR-021). Do the same for the "Courses to start" cards in `routes/-components/signed-in-home.tsx` (one link per card whose name contains its visible text). Tests: one link per card; its name contains the title; the description has `line-clamp-3`. This changes one existing expectation on purpose: locators that find a card's link by "Preview <title>" (in portal tests and in `packages/e2e/src/helpers/`) now find it by the title. Update them and say so in the pull request.
- [x] T042 [P] [US8] Tests first (a new `packages/websites/student-portal/src/routes/instructors/-handle.test.tsx` or the route's existing test), then in `routes/instructors/$handle.tsx` (research R-8): remove `size="lg"` from `Avatar` so `size-28` applies; when `profile.courses` is empty render "No published courses yet." (`text-sm text-muted-foreground`) in place of the grid (FR-024). Tests: the avatar has no `data-size="lg"`; the empty line shows for an instructor with no courses and not otherwise.
- [x] T043 [US8] In `phone-width.e2e.ts` and one desktop scenario (`search.e2e.ts`): with a course whose description is 500 characters next to one with a single line, the taller card is at most 1.5 times the shorter's height (SC-011); clicking a card's title opens the course. On the instructor's profile the avatar's bounding box is 112px wide. `screenshot(page, 'course cards')` and `'instructor profile'`.
- [x] T044 [US8] Run `pnpm nx run @discava/student-portal:test` (once), lint, typecheck; fix failures in the code.

---

## Phase 10: User Story 9 - The rules are written down for the next change (Priority: P3)

**Goal**: The UI rules load for any agent working in a portal or in the shared components.

**Independent test**: quickstart steps 31 and 32.

- [x] T045 [US9] Create `packages/websites/CLAUDE.md` and `packages/common/shadcn/CLAUDE.md` with the two blocks in [contracts/ui-rules.md](./contracts/ui-rules.md), word for word unless a merged phase made a statement untrue (a component renamed, a helper moved): then state what is true and say so in the pull request. Leave out any rule whose supporting piece has not merged yet (for example `RouteAnnouncer` before Phase 8) and list what was left out in the pull request, so the phase that adds the piece adds the rule.
- [x] T046 [P] [US9] In the root `CLAUDE.md`, add one Architecture bullet for `packages/websites` naming its `CLAUDE.md` ("UI rules for every portal screen and shared component: the two widths and states to check, layout, links, focus, errors"), and add "see `packages/websites/CLAUDE.md`" to the `packages/common/shadcn` bullet. In `CONTRIBUTING.md`, under "Code Style and License Headers" or a new short "UI changes" heading beside it, add one sentence pointing to the same file. Do not move or restate the existing conventions (text-only buttons, file layout, screenshots).
- [x] T047 [US9] Read the two new files against the root `CLAUDE.md` and `.specify/memory/constitution.md` and remove anything said twice or contradicted (FR-033). Run `pnpm lint` so the license-header generator and Biome accept the new files, and `graphify update .`.
- [ ] T048 [US9] (human) Start a fresh agent session in `packages/websites/student-portal`, ask it to add a small filterable list page, and review the result against the rules: note in the pull request any defect the rules should have prevented, and tighten the rule.

---

## Phase 11: Polish - the whole flow, by hand

**Goal**: Confirm on a running stack what tests cannot.

- [x] T049 (human) On the local stack with all phases merged, walk [quickstart.md](./quickstart.md) at 375px and 1440px, saving screenshots to `tmp/screenshots/pr-<number>/`. Compare the network panel with `main` for the course page, a lesson and a search: the same requests, in the same order.
- [ ] T050 (human) On a real phone (or the browser's device mode with touch), enrol in a course, take a quiz and search with filters; confirm nothing needs a sideways scroll or a zoom to tap, and that no control you had to use is smaller than 24px. At 1440px with the browser's text zoom at 200%, confirm the lesson and search pages still do not scroll sideways.
- [x] T051 Record in `spec.md`'s Assumptions, as a note with the date, anything the walk found that this spec left out of scope, so the next audit starts from it. Do not widen this feature.

---

## Dependencies

- Phase 1 comes first. Phase 2 (US1) uses `ResponsivePanel` and the viewport helper, and creates `phone-width.e2e.ts`, which Phases 3, 4, 5 and 9 add to.
- Phase 5 (US4) edits `catalogue-results.tsx`; Phase 9 (US8) edits `course-card.tsx`, which it renders: merge 5 before 9. Phase 7 (US6) also touches `catalogue-results.tsx` (one prop); whichever merges second rebases.
- Phase 8 (US7) edits `course-player.tsx` and `lesson-page.tsx` after Phase 2 and Phase 3.
- Phase 10 (US9) may merge at any point; T045 says how to handle rules whose pieces are not merged yet.
- Within a phase, tasks marked [P] touch different files.

## Requirement coverage

| Requirement | Tasks |
|-------------|-------|
| FR-001 no sideways scroll | T004, T005, T006, T012, T016, T021 |
| FR-002 lesson column wider | T004, T007 |
| FR-003 outline closed on a phone | T004, T006 |
| FR-004 filters closed on a phone | T018, T021 |
| FR-005 top bar fits | T014, T016 |
| FR-006 suggestions visible | T015, T016 |
| FR-007 tab bars scroll inside | T009, T012 |
| FR-008 in-page links | T009, T010, T011, T012 |
| FR-009 no dead link | T011 |
| FR-010 focus on navigation | T035, T036, T038, T040 |
| FR-011 page titles | T034, T036, T038 |
| FR-012 one main heading | T037 |
| FR-013 step links: motion and focus | T010 |
| FR-014 filter panel and focus kept | T018, T021 |
| FR-015 quiz focus | T023, T026 |
| FR-016 quiz announcements | T023, T028 |
| FR-017 numbered navigator | T024, T026 |
| FR-018 filter row is one target | T019 |
| FR-019 "Submit answers" and attempt line | T024, T026 |
| FR-020 card link | T041 |
| FR-021 card description and title | T041, T043 |
| FR-022 icons keep their size | T025 |
| FR-023 category search box | T020 |
| FR-024 instructor profile | T042, T043 |
| FR-025 error sentences | T029, T031 |
| FR-026 "Try again" | T030, T031, T032 |
| FR-027 a spinner says what it waits for | T037 |
| FR-028 no request changes | T018, T031, T049 |
| FR-029 shared fixes in shared packages | T001, T023, T029, T030, T034, T035; other portals' tests in T027, T033 |
| FR-030 text-only buttons | the rules for every task; T046 leaves the convention where it is |
| FR-031 rules loaded for portal work | T045, T046 |
| FR-032 how to audit a screen | T045 |
| FR-033 no repetition or conflict | T047 |
| FR-034 e2e fails on sideways scroll and stray section links | T002, T006, T012 |

US8's scenario 7 (step links with reduced motion) is done in Phase 3 by T010, because it is the same edit as the step links' address. The 200% zoom edge case and SC-010 (no required control under 24px) are checked by hand in T049 and T050; the controls the audits found too small are fixed by T019 and T024.

## Parallel example

After Phase 2 merges, three agents can take Phase 3 (US2), Phase 4 (US3) and Phase 6 (US5) at once: they touch `course-page.tsx` and `lesson-page.tsx`; `site-layout.tsx` and the search components; and the shared quiz files.

## Implementation strategy

Phases 1 to 4 are the P1 slice and fix what stops people using the portal on a phone or leaving a page by accident; ship them first. Phases 5 to 8 make the catalogue, the quiz and errors usable with a keyboard. Phases 9 and 10 are polish and prevention.
