---

description: "Task list for the course editor section menu"
---

# Tasks: Course Editor Section Menu

**Input**: Design documents from `/specs/20261124-190554-course-editor-section-nav/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/section-menu.md](./contracts/section-menu.md), [quickstart.md](./quickstart.md)

**Tests**: The Discava constitution (principle IV) requires them, so they are included: component tests for `useCurrentSection`, `SectionMenu` and `useUnsavedSections`, and steps in three existing `packages/e2e` scenarios. No invariant work: the feature writes no record (plan, Impact check). Write each task's tests first and see them fail. Never weaken an existing test to make it pass. Where a task changes behaviour an existing test pins (the heading offset class in `-route.test.tsx`, the `SectionLinks` name), the task names the change and the PR description says so.

**Who runs what**: an automated agent implements these tasks without `pnpm dev` or Docker. It runs unit and component tests, lint, typecheck and `build` locally. The e2e steps are written by the agent but run on PR CI (`pr-checks.yml`'s `E2E tests` job). Tasks marked **(human)** need a running local stack or people, and are done by a reviewer before merging.

**Organization**: Three agent PRs merged in order, each leaving `main` green and working, then a reviewer's checks. Story labels: US1 the menu stays and marks the current section (P1), US2 the current section is told, not only shown (P1), US3 unsaved changes are visible (P2). `$EDITOR` below stands for `packages/websites/instructor-portal/src/routes/_authenticated/my-courses_/$courseId`; other paths are relative to the repository root. There is no tracking issue yet; open one before PR 1 and reference it as "Part of #<n>" in every PR, with only the last PR closing it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: which user story the task serves (US1 to US3)
- **(human)**: needs a running local stack or people; not done by the agent

---

## Phase 1: Foundational: the current-section hook and the renamed menu (blocks every story)

**Goal**: the pieces every story builds on, with no visible change: `SectionLinks` becomes `SectionMenu` with the same behaviour, and the hook that works out the current section exists and is tested. Merged together with Phase 2 as PR 1.

- [ ] T001 Rename `$EDITOR/-components/section-links.tsx` to `$EDITOR/-components/section-menu.tsx` and the component `SectionLinks` to `SectionMenu` (`git mv`, so history follows), and `section-links.test.tsx` to `section-menu.test.tsx`. Update the import and use in `$EDITOR/route.tsx` and the doc comment. No behaviour change: every existing test in the renamed file passes unchanged apart from the component's name (research R-7).
- [ ] T002 [P] Test first, then write `$EDITOR/-components/use-current-section.ts` per research R-4 and contracts/section-menu.md: `useCurrentSection(ids)` returns `{ current, select }`. It measures on window `scroll` (passive), `resize` and a `ResizeObserver` on `main` (or `document.body` when there is no `main`), at most once per `requestAnimationFrame`. The current id is the last id whose element's `getBoundingClientRect().top` is at or above its computed `scroll-margin-top` + 1px, `ids[0]` if none is, and the last id when `innerHeight + scrollY >= document.documentElement.scrollHeight - 1`. An id with no element is skipped. `select(id)` sets `current` at once and ignores measurements until 120ms pass with no `scroll` event, then measures. It measures again when `ids` changes, and if `current` is no longer in `ids` the rule picks a new one. On unmount it removes listeners and the observer and cancels the pending frame and timer. Tests in `$EDITOR/-components/use-current-section.test.tsx` (jsdom: stub each heading's `getBoundingClientRect` and `getComputedStyle(...).scrollMarginTop`, and the window's `scrollY`, `innerHeight` and `scrollHeight`; fake timers; a stubbed `ResizeObserver` from `installJsdomStubs` or a local one): the first id before any heading passes the line; the last heading passed wins; a heading exactly on the line counts; end of page gives the last id; `select` holds through scroll events and releases after 120ms of quiet; `ids` losing the current id moves it; listeners are removed on unmount (data-model.md "Current section").

**Checkpoint**: tests, lint and `build` pass; the editor looks and behaves as before.

---

## Phase 2: User Story 1 - The menu stays on screen and marks the current section (Priority: P1) 🎯 MVP (PR 1)

**PR title**: `feat(course-editor-section-nav): a section menu that stays on screen and marks where you are`

**Goal**: at 1280px and up, the menu is a sticky list beside the sections; below that, a row stuck under the portal's header. Exactly one link, the current section's, is marked, and a link's mark holds through its smooth scroll.

**Independent test**: open the editor of a course with every section shown, at 1280px and at 375px; use each link, then scroll from top to bottom; the menu stays visible and marks the section whose heading was passed last (spec US1).

- [ ] T003 [US1] Test first (in `$EDITOR/-components/section-menu.test.tsx`), then in `section-menu.tsx` use `useCurrentSection(sections.map(s => s.id))`: the current link gets `aria-current="location"` and no other does; a link's `onClick` calls `select(id)` (the router `Link` still changes the hash); the address-scroll effect calls `select(hash)` just before it scrolls, so a section opened from its address is marked. Style the mark from `aria-current` (research R-5): below `xl` a filled chip (`aria-[current=location]:bg-primary aria-[current=location]:text-primary-foreground aria-[current=location]:border-primary`); at `xl` a 2px leading bar and `font-semibold`, the others `xl:border-transparent` with muted text. Keep every link at least 24px tall. Tests: exactly one `aria-current`; clicking marks it at once; a hash marks its section once the scroll runs; scrolling that changes the current section doesn't navigate (the mocked router's `navigate` isn't called and the hash is unchanged); all existing cases still pass (FR-005, FR-006, FR-007, FR-010).
- [ ] T004 [US1] In `section-menu.tsx`, give the one `nav` both layouts with `xl:` classes (research R-2, R-3, contracts/section-menu.md "Layout"). Below `xl`: `sticky top-16 z-[5] -mx-6 border-b bg-background/95 px-6 backdrop-blur` with the existing `overflow-x-auto` row. At `xl`: `xl:sticky xl:top-20 xl:self-start xl:mx-0 xl:border-0 xl:px-0 xl:bg-transparent xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto`, with the list in one column (`xl:flex-col`). When `current` changes and the viewport is below 1280px (`matchMedia('(min-width: 1280px)')` false), call `scrollIntoView({ block: 'nearest', inline: 'nearest', behavior })` on the current link, `behavior` `auto` under `prefers-reduced-motion`. Test: the row's `scrollIntoView` is called with `block: 'nearest'` on a change below `xl`, and not at `xl` (stub `matchMedia`) (FR-002, FR-003, US1 scenario 9).
- [ ] T005 [US1] In `$EDITOR/route.tsx`, below the header card: wrap the menu and the sections in `xl:grid xl:grid-cols-[12rem_minmax(0,1fr)] xl:gap-8`, the menu first and the sections (the archived-course notice, Course content, settings, Announcements, Archived) in one `min-w-0 space-y-6` column. Widen the editor's wrapper from `max-w-5xl` to `max-w-5xl xl:max-w-[78rem]` so the sections keep up to 1024px beside the menu. The header card stays above the grid at full width (spec Assumptions, research R-2).
- [ ] T006 [US1] Change every section heading's `scroll-mt-20` to `scroll-mt-32 xl:scroll-mt-20`: the headings in `$EDITOR/route.tsx`, `$EDITOR/-components/course/course-first-lesson-prompt-form.tsx` and `$EDITOR/-components/course/archived-section.tsx`. Update `$EDITOR/-route.test.tsx` ("links to the sections on the page") to expect both classes instead of `scroll-mt-20`; name this in the PR description as a change the spec requires (FR-004; plan, "Tests that change meaning").
- [ ] T007 [US1] Extend `packages/e2e/src/scenarios/phone-width.e2e.ts`'s step "the content comes first, and the section links lead to each section": after clicking "Announcements", assert the "Course sections" navigation is in the viewport and its "Announcements" link has `aria-current="location"`, and that no other link in it does; then `window.scrollTo(0, 0)`, wait for "Content" to have `aria-current`, assert the address still ends in `#announcements` (FR-007), and assert `expectNoSidewaysScroll`. For each link in the row, assert `expectTargetAtLeast24` (from `packages/e2e/src/helpers/viewport.ts`; it scrolls the link into view first). Add `screenshot(page, 'course editor section row marks announcements')` (US1 scenarios 3, 4, 8, 9; SC-003).
- [ ] T008 [US1] Add a step to `packages/e2e/src/scenarios/course-price.e2e.ts` at the default Desktop Chrome width (1280px, where the side menu starts): use the "Course sections" link "Price", assert the Price heading is in the viewport and focused and the link has `aria-current="location"`; scroll to the end of the page and assert the menu is still in the viewport and its last link is marked. Add `screenshot(page, 'course editor side menu marks price')` (US1 scenarios 1, 2, 4, 7).
- [ ] T009 [P] [US1] Add the rule from research R-9 to `packages/websites/CLAUDE.md` under "Links and navigation": "A page long enough for in-page section links keeps them on screen (`sticky`) and marks the section being read with `aria-current="location"`. Scrolling doesn't change the address; using a link does." (FR-012)

**Checkpoint**: PR 1 is merged; the reported problem is fixed at both widths.

---

## Phase 3: User Story 2 - The current section is told, not only shown (Priority: P1) (PR 2)

**PR title**: `feat(course-editor-section-nav): the section menu works with the keyboard, reduced motion and zoom`

**Goal**: the mark is announced and visible without colour, focus order and focus rings are right, motion honours reduced motion, and the side list stays reachable at 200% zoom.

**Independent test**: with the keyboard alone, Tab into the menu, use a link, and check the marked link's `aria-current`; check the mark in greyscale; turn on reduced motion and see a jump; zoom to 200% and reach every link (spec US2).

- [ ] T010 [US2] Test first, then in `$EDITOR/-components/section-menu.tsx`: every link has a visible focus ring (`focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`, offset so the chip's fill doesn't hide it); the mark differs from other links by more than colour at both layouts (fill plus `font-semibold` below `xl`, bar plus `font-semibold` at `xl`); the menu comes before the sections in the DOM at both layouts, so Tab reaches it before their controls. Tests: the marked link carries `font-semibold` and the others don't; the `nav` precedes the first section heading in document order (US2 scenarios 1 to 3).
- [ ] T011 [US2] Test first, then make every motion the menu starts honour `prefers-reduced-motion`: the heading scroll already does; the row's `scrollIntoView` from T004 uses `behavior: 'auto'` when reduced motion is asked for. Test both, stubbing `matchMedia` (US2 scenario 4, FR-008).
- [ ] T012 [US2] Extend `packages/e2e/src/scenarios/course-price.e2e.ts`'s menu step (T008): focus the menu's first link with the keyboard (`Tab` from the course's header card's last link until a link in "Course sections" is focused), press `Enter` on "Price", and assert the Price heading is focused. Add `screenshot(page, 'course editor side menu focus ring')`.

**Checkpoint**: PR 2 is merged.

---

## Phase 4: User Story 3 - Unsaved changes are visible from anywhere on the page (Priority: P2) (PR 3)

**PR title**: `feat(course-editor-section-nav): mark sections with unsaved changes in the section menu`

**Goal**: a section with unsaved changes shows a dot in the menu and says so in its link's name; the mark goes when the changes are saved, cancelled or discarded.

**Independent test**: change the price without saving, scroll to Announcements, and see "Price, unsaved changes" in the menu; save, and the mark goes (spec US3).

- [ ] T013 [US3] Test first, then add `useUnsavedSections(): ReadonlySet<string>` to `$EDITOR/-components/course/unsaved-changes-context.tsx` (research R-6, data-model.md "Unsaved sections"): the provider exposes, in a second context, the set of section ids (each dirty key's part before its first `:`) that have at least one dirty key; outside the provider it returns an empty set. Extend `$EDITOR/-components/course/unsaved-changes-context.test.tsx` (it exists since #974; keep its four existing cases unchanged) with: two keys under one section (`announcements:new`, `announcements:a1`) keep the section in the set until both are clean; a key unmounting clears it; a key without `:` (`price`) is its own section; outside the provider the set is empty.
- [ ] T014 [P] [US3] Change the report keys so each starts with its section's id (research R-6): `$EDITOR/-components/course/course-caption-languages-form.tsx` `caption-languages` → `captions`; `$EDITOR/-components/announcements/announcement-form.tsx` `announcement-<id>` → `announcements:<id>` and `announcement-new` → `announcements:new`. Their existing tests must pass unchanged.
- [ ] T015 [US3] Test first, then in `$EDITOR/-components/section-menu.tsx` read `useUnsavedSections()`: a link whose section is in the set shows a small dot after its label (`aria-hidden`, `shrink-0`, the same size at both layouts) and a visually hidden ", unsaved changes" (`sr-only`), so its accessible name is "Price, unsaved changes". Tests in `section-menu.test.tsx`, rendering inside `UnsavedChangesProvider` with a child that reports `price` dirty: the link's name is "Price, unsaved changes"; after reporting clean it is "Price" (FR-009, US3 scenarios 1, 2).
- [ ] T016 [US3] Extend `packages/e2e/src/scenarios/unsaved-work.e2e.ts`'s step "leaving the editor with a changed price asks first": after changing the price, assert the "Course sections" navigation has a link named "Price, unsaved changes"; take `screenshot(page, 'section menu marks unsaved price')` before leaving. In the same scenario, after the change is discarded or saved, assert the link is named "Price" again (US3 scenarios 1, 2).

**Checkpoint**: PR 3 is merged; the agent's work is done.

---

## Phase 5: Polish: the reviewer's checks

**Goal**: what tests can't show: a screen reader, real scrolling, greyscale and zoom.

- [ ] T017 (human) Before PR 1 merges, follow [quickstart.md](./quickstart.md) "US1" at 1440px and 375px on a local stack: the menu stays visible, the mark follows scrolling with no flicker during a link's smooth scroll, the end-of-page and top-of-page rules hold, and resizing across 1280px keeps the mark. Save screenshots to `tmp/screenshots/pr-<number>/`.
- [ ] T018 (human) Before PR 2 merges, follow quickstart.md "US2": a screen reader announces the marked link as the current location and no other; the mark stands out in greyscale; reduced motion jumps; at 200% zoom every link of the side list can be reached and the page doesn't scroll sideways.
- [ ] T019 (human) Before PR 3 merges, follow quickstart.md "US3" and "Same requests": the unsaved dot and its announcement for Price and a new announcement, none on an archived course, and the same list of requests before and after (SC-005).

---

## Dependencies and order

- Phase 1 (T001, T002) and Phase 2 (T003 to T009) are one issue and one PR: the tooling groups everything up to the first story. T001 and T002 run in parallel; T003 needs both; T004 needs T003; T005 and T006 need T004; T007 and T008 need T005 and T006; T009 runs any time.
- PR 2 (T010 to T012) needs PR 1. T010 and T011 touch the same file, so run them in order; T012 after T010.
- PR 3 (T013 to T016) needs PR 1, not PR 2: it may be written alongside PR 2 and rebased; merge in numeric order. T013 and T014 run in parallel; T015 needs T013; T016 needs T014 and T015.
- T017 to T019 are each done before their PR merges.
- Within a phase, tests come first, and tasks run in ID order except those marked [P].

## Parallel examples

- PR 1: T001 (rename) and T002 (hook) at once; T009 (the rule) alongside anything.
- After PR 1: PR 2 and PR 3 by two agents at once.
- PR 3: T013 (context) and T014 (report keys) at once.

## Implementation strategy

MVP is PR 1: the menu stays on screen and marks the current section at both widths, which is the whole reported problem. PR 2 makes the same information reach keyboard and screen-reader users and checks motion and zoom. PR 3 adds the unsaved mark, which uses state the editor already has. Each PR runs `pnpm nx affected --target build` before it is opened and stays within its phase's files.
