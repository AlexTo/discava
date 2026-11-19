---

description: "Task list for search suggestions as you type"
---

# Tasks: Search Suggestions as You Type

**Input**: Design documents from `/specs/20261119-195009-search-suggestions/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The Discava constitution (principle IV) requires tests, so they're included: unit tests for the query builder and procedure, portal component and hook tests, and an extended `packages/e2e` search scenario. No invariant is added, because the feature writes no shared record (plan, impact check). Write each phase's tests first and watch them fail. Never weaken an existing test to make it pass. The one intended locator change (the search box's role becomes `combobox`, T014) is named in its task and must be repeated in that PR's description.

**Who runs what**: An automated agent implements these tasks without `pnpm dev` or Docker. It runs unit and component tests, lint, typecheck, `build` and `synth` locally. The agent writes the e2e tests, but PR CI runs them (`pr-checks.yml`'s `E2E tests` job). Tasks marked **(human)** need a running local stack or people, and a reviewer does them before merging.

**Organization**: Four phases, each one agent PR, merged in order. Each leaves `main` green and working. Phases 1 and 2 form the first PR (the first story's phase ends the first implementation issue).

| Label | Story | Priority |
|-------|-------|----------|
| US1 | Jump straight to a course from the search box | P1 |
| US2 | Typing doesn't flood the server (debounce, stale answers, reuse) | P1 |
| US3 | Keyboard and screen reader | P2 |
| US4 | See every result from the dropdown | P3 |

US2 has no phase of its own: the dropdown can't ship sending a request per keystroke, so its tasks sit in Phase 2 beside US1's.

Paths are relative to the repository root. There's no parent issue: each PR says "Part of the search suggestions spec" and links `specs/20261119-195009-search-suggestions/`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)

---

## Phase 1: Foundational - `course.publicSuggest` in core-api

**Goal**: A public suggestions query with an API Gateway throttle of its own, which no portal calls yet. Nothing users see changes.

**Independent test**: `pnpm nx run @discava/core-api:test -- --run suggest-query.test.ts search.test.ts router.test.ts`, `pnpm nx run @discava/common-infra-config:test -- --run env-overrides.test.ts` and `pnpm nx run @discava/common-constructs:test -- --run core-api.test.ts` pass, and `pnpm nx run @discava/infra:synth` succeeds.

- [x] T001 [P] Tests first, then add `SuggestCoursesInputSchema` and `SuggestCoursesOutputSchema` (with `ISuggestCoursesInput` and `ISuggestCoursesOutput` types) to `packages/apis/core-api/src/schema/search.ts`, exported through `schema/index.ts`, exactly as in [contracts/core-api-suggest.md](./contracts/core-api-suggest.md):
  - input `q: z.string().trim().min(3).max(200)`;
  - output `items` (at most 10) of `{ courseId: string, title: string, imageKey?: string }`.

  Schema tests (in `procedures/search.test.ts` or a new `schema/search.test.ts`): `"  ab  "` is refused, `"abc"` is accepted, and 201 characters are refused.
- [x] T002 [P] Tests first, then add `buildSuggestRequest(input: ISuggestCoursesInput)` in `packages/apis/core-api/src/helpers/suggest-query.ts`, returning the body in [contracts/core-api-suggest.md](./contracts/core-api-suggest.md):
  - `size: 10`, `track_total_hits: false`, `_source: ['courseId', 'title', 'imageKey']`;
  - a `function_score` around a `bool` with `must: match_bool_prefix` on `title`, and `filter: term status published`;
  - the `ratingBoost` multiplier with `missing: 1`;
  - sort `_score`, then `publishedAt` desc, then `courseId` asc;
  - no `aggs`.

  `helpers/suggest-query.test.ts` pins the whole body for one input, and asserts the published filter is present for every input and that the text is passed as a plain string.
- [x] T003 Tests first, then add `publicSuggestCourses` to `packages/apis/core-api/src/procedures/search.ts`:
  - built on `publicSearchProcedure`, with input and output from T001 and the request from T002;
  - a `SUGGEST_REQUEST_TIMEOUT_MS = 3_000` request timeout, with a comment pointing to research R-6;
  - a `TimeoutError` mapped to `TRPCError` `TIMEOUT` with the message "Search is starting up. Try again in a few seconds.", sharing the mapping with `publicSearchCourses` (extract a small function in the same file, not a new module);
  - hits mapped to `{ courseId, title, imageKey? }`, with no core-table read.

  Extend `procedures/search.test.ts`, mocking `getOpenSearchClient` as the file already does:
  - an anonymous caller gets mapped items;
  - an empty hit list gives `{ items: [] }`;
  - the request sent equals `buildSuggestRequest`'s;
  - a `TimeoutError` gives `TIMEOUT`;
  - `category.query` is never called.
- [x] T004 Register `publicSuggest: publicSuggestCourses` under `course` in `packages/apis/core-api/src/router.ts`, and add `'course.publicSuggest'` to `PUBLIC_OPERATIONS` (keep the list's order: after `'course.publicSearch'`). The existing check in `packages/apis/core-api/src/router.test.ts` must pass unchanged. If it lists the public operations by hand, add the new name there too, without weakening any other assertion.
- [x] T022 [P] Tests first, then add the suggest throttle's stage keys (research R-6):
  - `publicSuggestThrottleRateLimit?: number` (`@default 100`) and `publicSuggestThrottleBurstLimit?: number` (`@default 200`) on `CoreApiComponentConfig` in `packages/common/infra-config/src/stages.types.ts`, next to `publicThrottleRateLimit`, with doc comments saying they apply to `course.publicSuggest` only and are shared by every caller. Also correct `publicThrottleRateLimit`'s comment, which names only `course.publicList` and `course.publicView`: it applies to every operation in `PUBLIC_OPERATIONS`;
  - both keys as `'number'` under `coreApi` in `packages/common/infra-config/src/env-overrides.ts`, with a case in `env-overrides.test.ts` like the existing `THROTTLE_RATE_LIMIT` one;
  - in `packages/common/infra-config/src/stages.config.ts`, `5` and `10` on `discava-development` and `100` and `200` on `discava-production`, beside the `publicThrottle*` keys. Add a line to each stage's limits comment: suggestions have their own throttle because they fire on every typing pause.
- [x] T023 Tests first, then wire the throttle (after T004 and T022):
  - a `publicSuggestThrottle?: ThrottleSettings` prop on `CoreApi` in `packages/common/constructs/src/app/apis/core-api.ts` (`@default` `publicThrottle`). The method setting for `course.publicSuggest` uses it instead of `publicThrottle`; every other public operation and public extra route keeps `publicThrottle`. In `core-api.test.ts`, with `publicThrottle: { rateLimit: 2, burstLimit: 4 }` and `publicSuggestThrottle: { rateLimit: 7, burstLimit: 9 }`, assert the stage's `MethodSettings` give `/course.publicSuggest` GET 7 and 9 and `/course.publicSearch` GET still 2 and 4;
  - `publicSuggestThrottle(config)` in `packages/infra/src/stacks/api-limits.ts` beside `publicThrottle`, with `DEFAULT_PUBLIC_SUGGEST_THROTTLE = { rateLimit: 100, burstLimit: 200 }`;
  - `publicSuggestThrottle: publicSuggestThrottle(coreApiConfig)` passed to `CoreApi` in `packages/infra/src/stacks/core-api-stack.ts`.
- [x] T005 Run `pnpm nx run @discava/common-constructs:test -u` and `pnpm nx run @discava/infra:test -u` only if a snapshot changes because of the new public route or its throttle. Check that the only snapshot differences are the new `course.publicSuggest` method without the Cognito authorizer, and its method setting with the suggest throttle (100 / 200 by default, or the stage's values), and say so in the PR description.

---

## Phase 2: User Story 1 - Suggestions appear as you type and open a course (P1) 🎯 MVP

**Goal**: Typing 3 or more characters in "What do you want to learn?" shows up to 10 matching published courses after a 300 ms pause. Clicking or tapping one opens its page. A burst of typing sends one request, and an older answer never replaces a newer one. Enter still opens the results page.

**Independent test**: Component tests in `site-search.test.tsx` pass with fake timers. The e2e test "suggestions offer a published course by the start of its title" passes on PR CI, with screenshots.

- [x] T006 [P] [US2] Tests first, then add `useDebouncedValue<T>(value: T, delayMs: number): [T, () => void]` in `packages/websites/student-portal/src/hooks/use-debounced-value.ts`. It returns the value once it has stayed unchanged for `delayMs`, and a `cancel()` that drops the pending update. `hooks/use-debounced-value.test.ts` (vitest fake timers):
  - one update after a burst of changes;
  - no update before the delay;
  - `cancel()` stops a pending update;
  - unmounting clears the timer.
- [x] T007 [P] [US1] Tests first, then add `highlightTitle(title: string, typed: string): { text: string; match: boolean }[]` in `packages/websites/student-portal/src/lib/title-highlight.ts` (research R-5). Each word of `title` that starts with one of the typed words (case- and accent-insensitive, using `Intl.Collator` base sensitivity on the word's leading characters) has that leading part marked `match: true`. Joining the parts' text always gives back `title` exactly. `lib/title-highlight.test.ts` covers:
  - "pyth" in "Python for Data Analysis";
  - "data py" (two words, either order);
  - "café" against "Cafe";
  - punctuation in the title;
  - no match;
  - empty typed text.
- [x] T008 [US1] Tests first, then add `SiteSearchSuggestions` in `packages/websites/student-portal/src/components/site-search-suggestions.tsx`, a presentational list under the box. It takes `items`, `typed`, `loading`, `id` and `onChoose(courseId)`.
  - Each row is a button-like element with the course thumbnail (`usePublicMediaUrl()(imageKey)`, or a neutral placeholder `div` when absent) and the title rendered from `highlightTitle` with matched parts in `<mark>` (bold, no background).
  - Rows use `onMouseDown={e => e.preventDefault()}`, so choosing one doesn't blur the input first.
  - Text only, no arrow icons.
  - The list is absolutely positioned under the form, full width of the box, `max-w-[calc(100vw-2rem)]`, so it never scrolls horizontally at 375 px.
  - When `loading` is set and there are no items, it shows "Searching…".
- [x] T009 [US1] [US2] Tests first, then wire `packages/websites/student-portal/src/components/site-search.tsx`:
  - `const SUGGEST_DEBOUNCE_MS = 300`, `const SUGGEST_MIN_LENGTH = 3` and `const SUGGEST_MAX_LENGTH = 200` (the input schema's bounds);
  - the trimmed text is debounced with T006;
  - `useQuery(trpc.course.publicSuggest.queryOptions({ q }, { enabled: open && q.length >= SUGGEST_MIN_LENGTH && q.length <= SUGGEST_MAX_LENGTH, staleTime: 60_000, retry: false, placeholderData: keepPreviousData }))`;
  - the dropdown is open while the box has focus, the trimmed text is at least 3 characters, and there are items (or loading with previous items);
  - it closes when the text drops under 3 characters;
  - on `/search` the box starts with the current query and the dropdown closed, until the text is edited (track a `touched` flag reset whenever `currentQuery` changes);
  - choosing a row cancels the debounce, closes the dropdown and navigates to `/learn/$courseId`;
  - submitting cancels the debounce and closes the dropdown before navigating, as today;
  - any query error renders nothing (no `ErrorAlert`), per research R-6.

  Get `trpc` the same way `components/catalogue-results.tsx` does. Tests in `packages/websites/student-portal/src/components/site-search.test.tsx` use `renderWithCoreApi` (from `src/test/render-with-core-api`) with a `course.publicSuggest` handler, vitest fake timers, and `signedIn: false`:
  - 2 characters send no request;
  - 3 characters send one after 300 ms and none before;
  - typing "javascript" one key at a time sends exactly one request, for "javascript" (SC-002);
  - a slow "javas" answer resolving after the "javascript" answer leaves the "javascript" list shown (SC-003);
  - retyping a recent text sends no second request;
  - clicking a row navigates to `/learn/<courseId>`;
  - Enter before 300 ms navigates to `/search?query=…` and sends no suggestion request;
  - a handler that throws (an `ApiError` with `TIMEOUT`) shows no alert, and the box still submits;
  - on `/search?query=linear` the dropdown is closed at load;
  - 10 items render 10 rows;
  - 201 characters send no request.
- [x] T010 [US1] Make sure the existing student-portal tests that render the top bar still pass. `src/routes/-routes.test.tsx` and `src/routes/search/-search.test.tsx` add a `course.publicSuggest` handler returning `{ items: [] }` only where a test now fails because it's missing, without changing any existing assertion.
- [x] T011 [US1] Add `suggestInSiteSearch(page, text)` to `packages/e2e/src/helpers/student-portal.ts`. It fills the search box (found the same way `searchWithSiteSearch` finds it) and waits for the suggestions list (`getByRole('listbox', { name: 'Course suggestions' })`, or for this phase the list's `data-testid="site-search-suggestions"` if T013's ARIA isn't in yet, which T013 then replaces).
- [x] T012 [US1] Add the test "suggestions offer a published course by the start of its title" to `packages/e2e/src/scenarios/search.e2e.ts`:
  - publish a uniquely named course (`uniqueName('Suggestible course')`) with `createPublishedCourseViaApi`, and create a draft with a title that shares the prefix;
  - signed out, type the first word of the title plus the first 3 letters of the next, using `expectAfterReloads`, since indexing lags by a few seconds;
  - expect the published course in the list and the draft absent, and take `screenshot(page, 'search-suggestions-open')`;
  - click it and expect the course page's heading, taking `screenshot(page, 'search-suggestion-course-page')`;
  - archive the course and expect it gone from suggestions after reloads.

---

## Phase 3: User Story 3 - Keyboard and screen reader (P2)

**Goal**: The box follows the WAI-ARIA combobox pattern. Up and Down move a highlight, Enter chooses, Escape closes, and the count is announced.

**Independent test**: The keyboard and ARIA cases in `site-search.test.tsx` pass. The e2e test drives the dropdown by keyboard only.

- [ ] T013 [US3] Tests first, then apply [contracts/site-search-ui.md](./contracts/site-search-ui.md)'s ARIA and keyboard table to `packages/websites/student-portal/src/components/site-search.tsx` and `site-search-suggestions.tsx`:
  - the input gets `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls` (from `useId`) and `aria-activedescendant`;
  - the list gets `role="listbox"` and `aria-label="Course suggestions"`, and each row `role="option"`, a stable `id` and `aria-selected`;
  - a visually hidden `role="status"` region says "<n> suggestions" or "No courses match" when an answer is shown;
  - Down and Up wrap, and don't change the input text;
  - Enter on a highlighted row chooses it, and Enter with none highlighted submits;
  - Escape closes and keeps the text, and so does blur (Tab);
  - the highlight resets when the items change;
  - remove the `data-testid` fallback from T011.

  Component tests: every row in the keyboard table, `aria-expanded` toggling, `aria-activedescendant` following the highlight, and the status text for 3 items and for 0 items. Use `getByRole('combobox', { name: 'Search courses' })`.
- [ ] T014 [US3] Change `searchWithSiteSearch` in `packages/e2e/src/helpers/student-portal.ts` to find the box with `getByRole('combobox', { name: 'Search courses' })` instead of `getByRole('searchbox', …)`. This is an intended locator change: the box's ARIA role changed (FR-012), and its fill, Enter and wait-for-`/search` behavior stays the same. Update the other tests that find this box by `getByRole('searchbox', { name: 'Search courses' })` the same way, changing nothing else: today `packages/websites/student-portal/src/routes/search/-search.test.tsx` and `src/routes/-routes.test.tsx`. Don't touch other search boxes, such as the category page's "Search <category>" box in `routes/category/-category.test.tsx`. List the changed tests in the PR description.
- [ ] T015 [US3] Extend the Phase 2 e2e test in `packages/e2e/src/scenarios/search.e2e.ts` with a keyboard-only step:
  - type, press Down until the course is highlighted, and take `screenshot(page, 'search-suggestions-keyboard')`;
  - press Enter and expect the course page;
  - then type again, press Escape, and expect the listbox hidden and the text kept.

---

## Phase 4: User Story 4 - See every result from the dropdown (P3)

**Goal**: The dropdown always ends with "See all results for '<text>'", and says "No courses match" when nothing does.

**Independent test**: The component tests for the last row and the empty state pass. The e2e test chooses "See all results".

- [ ] T016 [US4] Tests first, then add the last row "See all results for '<text>'" (a `role="option"` that keyboard navigation reaches, per the contract) and the "No courses match" row to `packages/websites/student-portal/src/components/site-search-suggestions.tsx`. With no items the dropdown stays open and shows both. Choosing the last row navigates to `/search?query=<trimmed text>` and closes the dropdown, the same as submitting (`site-search.tsx`). The status text from T013 still counts courses only. Component tests cover:
  - the row is present with items and with none;
  - choosing it by click and by Down, then Enter, navigates to `/search?query=…`;
  - "No courses match" shows for an empty answer.
- [ ] T017 [US4] Extend `packages/e2e/src/scenarios/search.e2e.ts`: type a unique nonsense string (`uniqueName('zzq')`), expect "No courses match", take `screenshot(page, 'search-suggestions-empty')`, choose "See all results", and expect `/search?query=` in the URL.

---

## Phase 5: Polish - docs and manual checks

**Goal**: The design page describes suggestions. Reviewers confirm timing, screen reader output and phone layout by hand.

- [ ] T018 [P] Add a "Suggestions" section to `docs/src/content/docs/en/design/search.mdx` after "The search procedure":
  - `course.publicSuggest`, and why it's separate from `publicSearch` (research R-2);
  - the `match_bool_prefix` query and its known stemming limit, with `search_as_you_type` as the follow-up (R-1);
  - the 3-character threshold, the 300 ms debounce and last-text-wins caching (R-3);
  - the 3 s timeout and silent failure, and the throttle of its own: why the shared public throttle is too tight, the stage keys and each stage's values (R-6).

  Add a "Spec" link to `specs/20261119-195009-search-suggestions/spec.md` in the page's existing link style. Note in the PR that translations of the other locales are pending.
- [ ] T020 (human) Run [quickstart.md](./quickstart.md) steps 1 to 6 and 8 to 10 against `pnpm dev`, saving screenshots to `tmp/screenshots/pr-<number>/`. Confirm in the browser's network panel that one `course.publicSuggest` request is sent per pause (SC-002), and that suggestions appear within 1 s of pausing with search warm (SC-001).
- [ ] T021 (human) Run quickstart step 7 with VoiceOver or NVDA. The suggestion count and the highlighted course are announced, and focus stays in the box (FR-012, SC-005).

---

## Dependencies

- Phase 1 → Phase 2 (the portal calls `course.publicSuggest`) → Phase 3 (ARIA on the Phase 2 component) → Phase 4 (the last row joins Phase 3's keyboard navigation). Phase 5's T018 can start any time after Phase 1. T020 and T021 come after Phase 4.
- Within Phase 1: T001, T002 and T022 in parallel, then T003, then T004, then T023, then T005.
- Within Phase 2: T006 and T007 in parallel, then T008, then T009, then T010. T011 and T012 can be written alongside T009.

## Parallel examples

```text
Phase 1:  T001 (schema)  ║  T002 (query builder)  ║  T022 (throttle stage keys)
Phase 2:  T006 (debounce hook)  ║  T007 (title highlight)
```

## Implementation strategy

- **MVP**: Phases 1 and 2, one PR. Visitors get debounced suggestions that open a course, and Enter works as before.
- **Then**: Phase 3 (accessibility, the box's role becomes `combobox`), then Phase 4 ("See all results" and the empty state). Each is a small PR that leaves `main` working.
- **Finally**: Phase 5 docs, and the reviewer's manual checks before the last PR merges.
