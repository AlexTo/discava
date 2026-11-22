---

description: "Task list for the admin portal UX fixes"
---

# Tasks: Admin Portal UX Fixes

**Input**: Design documents from `/specs/20261123-081203-admin-portal-ux-fixes/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [audit.md](./audit.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: The Discava constitution (principle IV) requires tests, so they are included:

- **Component tests** for each changed screen, and for `CognitoAuth`'s new prop.
- **E2e:** an admin section in `phone-width.e2e.ts`, an admin case in `breadcrumbs.e2e.ts`, and a views-in-the-address case.

The feature writes no shared record, so there is no invariant work. Write each task's tests first and watch them fail. Never weaken an existing test to make it pass: the expectations this feature changes on purpose are listed in plan.md's "Tests that change meaning", named in the task that changes them, and the pull request says so.

**Who runs what**:

- **The agent:** an automated agent implements these tasks without `pnpm dev` or Docker. It runs unit and component tests, lint, typecheck and `build` locally.
- **PR CI:** the agent writes the e2e tests, but PR CI runs them (`pr-checks.yml`'s `E2E tests` job). A CI failure is the feedback for those.
- **People:** tasks marked **(human)** need a running local stack or people (a screen reader, a real phone), and a reviewer does them before merging.

**Organization**:

- **Phases:** there are eleven. Each is one agent pull request and leaves `main` green, except that Phases 1 and 2 form the first one: the first story's phase ends the first implementation issue.
- **Order:** Phases 3 to 10 depend only on Phase 1 and can merge in any order, apart from the pairs in "Dependencies".
- **Waiting on the instructor-portal spec:** a task marked **Needs IP Tnnn** relies on a shared change that the [instructor-portal UX fixes](../20261123-000428-instructor-portal-ux-fixes/tasks.md) make. Before starting it, check that the named task is ticked in that file, or its change is on `main`. If it isn't, do the rest of the phase, leave the task unticked, and say so in the pull request; it is picked up again when the IP task merges. Never make the shared change here.
- **Paths:** paths are relative to the repository root. `AP/` stands for `packages/websites/admin-portal/src/`, `R/` for `AP/routes/`, and `SH/` for `packages/common/shadcn/src/`.
- **Parent issue:** there is none. Pull requests say "Part of the admin portal UX fixes spec" and link `spec.md`.

| Label | Story | Priority |
|-------|-------|----------|
| US1 | Every admin page fits a phone | P1 |
| US2 | Links, breadcrumbs and the home page lead somewhere real | P1 |
| US3 | Every page says where you are and what it is waiting for | P2 |
| US4 | The keyboard keeps its place | P2 |
| US5 | Typed work is never lost by accident | P2 |
| US6 | Errors and blocked actions say what to do next | P2 |
| US7 | Views can be shared and come back to | P3 |
| US8 | Controls are big enough and say what they are | P3 |
| US9 | The rules and the tests cover the admin portal | P3 |

**Rules for every task**:

- **No request changes (FR-028):** do not add, remove or reorder a query or mutation, or change an input. "Try again" calls an existing query's `refetch`. A check moved from a disabled button to submit sends nothing when it fails.
- **Text-only buttons:** buttons carry text only, with no arrow icons.
- **Shared fixes stay shared (FR-030):** a fix to a shared component is made in `packages/common/shadcn`, never overridden in the admin portal. This feature changes only `SH/components/cognito-auth.tsx` there (T001).
- **The Stripe key:** never kept in state, the DOM or a message, and emptied on every submit, as today.
- **Screenshots:** every phase that changes what a user sees adds an e2e case with `screenshot()` on the changed screen (constitution VIII; the `UI Screenshots` PR check fails without one). Phases whose other e2e work waits on IP have a screenshot task that doesn't.
- **Finding IDs:** these are from [audit.md](./audit.md). Each task names the ones it fixes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)

---

## Phase 1: Foundational - the sign-in wait and the admin test data

**Goal**: The one shared change this feature makes, and the e2e data helper the admin cases use. Nothing users see changes.

**Independent test**: `pnpm nx run @discava/common-shadcn:test -- --run cognito-auth` passes with the new tests.

- [ ] T001 [P] Test first in `SH/components/cognito-auth.test.tsx`, then give `CognitoAuth` in `SH/components/cognito-auth.tsx` an optional `fallback?: React.ReactNode`, returned in place of today's `<Spinner />` while `autoSignIn` redirects or `auth.isLoading` is true without a navigator ([contracts/shared-components.md](./contracts/shared-components.md), research R-6).
  - **Default:** with no `fallback`, the output is today's `<Spinner />`, so no portal changes.
  - **Tests:** with `fallback`, it renders the fallback while signing in; without it, the spinner, as today.
  - **If IP T037 has already added a prop for this,** use that prop and tick this task with a note.
- [ ] T002 [P] Add `createRevokableCertificateViaApi(label)` to `packages/e2e/src/helpers/certificate.ts`: a fresh instructor publishes a one-reading course whose title is 80 characters holding a 70-character word; a fresh student named "Bartholomew-Maximilian Featherstonehaugh-Wolfeschlegel" completes it through core-api (as `completeCourse` does through the portal); the helper waits for the certificate (`certificateCourseIdOf`, `courseCertificates`), revokes and restores it twice through admin-api with 500-character notes ending in a 70-character word (so the history shows D-08), and returns `{ certificateId, courseTitle, learnerName }`. Use the API rather than the portal so the phone case stays fast. Not used yet.
- [ ] T003 Run `pnpm nx run @discava/common-shadcn:test` (once), and lint and typecheck for `common-shadcn` and `e2e`. Fix failures in the code, not the tests.

---

## Phase 2: User Story 1 - Every admin page fits a phone (Priority: P1) 🎯 MVP

**Goal**: At 375px, with long content, no admin page scrolls sideways and every action is on screen. At 1440px nothing changes, apart from long words wrapping.

**Independent test**: quickstart, US1.

- [ ] T004 [P] [US1] Test first in `R/categories/-components/categories-screen.test.tsx`, then stack the categories table below `sm` in `R/categories/-components/categories-screen.tsx`, as research R-1 describes (B-01, B-02):
  - `table`, `tbody`, `td` get `max-sm:block`; `thead` gets `max-sm:sr-only`;
  - each `tr` is a grid below `sm` with areas in the columns' DOM order: `max-sm:grid max-sm:grid-cols-[auto_minmax(0,1fr)] max-sm:gap-x-3 max-sm:gap-y-1 max-sm:py-3 max-sm:[grid-template-areas:'name_name'_'slug_slug'_'status_count'_'actions_actions']`, and each `td` takes its area. Do not reorder the cells: a screen reader reads them in DOM order;
  - the name cell is `min-w-0 break-words [overflow-wrap:anywhere]`; the slug `break-all`;
  - the slug and the course count are each preceded by a label shown only below `sm` (`<span className="sm:sr-only">Slug: </span>`, "Courses: ");
  - the actions group is `flex flex-wrap gap-2 max-sm:justify-start`;
  - the rename form is `flex flex-wrap gap-2`, its field `min-w-0 flex-1 basis-40`.

  **Tests:** with a 60-character one-word name, the name cell has `break-words`, the slug `break-all`, the row and actions carry the stacking and wrapping classes, and Rename and Archive are still found by name in the row. jsdom has no layout; T008 checks the widths.
- [ ] T005 [P] [US1] Test first in `R/-components/reviews-screen.test.tsx`, then in `R/-components/reviews-screen.tsx` (C-01, research R-2):
  - the review text, the response text and the removal reason get `break-words [overflow-wrap:anywhere]`;
  - the reviewer's name line and the response heading get `min-w-0 break-words`;
  - the review's header row becomes `flex flex-wrap items-start justify-between gap-3`.

  **Test:** a review and a response holding a 70-character word render with those classes.
- [ ] T006 [P] [US1] Test first in `R/-components/certificates-screen.test.tsx`, then in `R/-components/certificates-screen.tsx` (D-01, D-08, research R-2):
  - the card's header row becomes `flex flex-wrap items-start gap-3`; the details block `min-w-0 flex-1 basis-full break-words sm:basis-0`; the certificate ID `break-all`;
  - the history list is `space-y-2`, and each entry's note is its own `block break-words` line.

  **Test:** with a 54-character learner name and an 80-character course title with a 70-character word, the details block has those classes, and Revoke is still found by name.
- [ ] T007 [P] [US1] Test first in `R/-components/payments-screen.test.tsx`, then in `R/-components/payments/changes-table.tsx` (E-01, research R-3): wrap the table in `<div role="region" aria-labelledby="recent-changes" tabIndex={0} className="overflow-x-auto">`; give the table `min-w-[36rem]` and its cells `px-2 first:pl-0 last:pr-0`; make the When cell `whitespace-nowrap tabular-nums` and the Key cell `whitespace-nowrap`. **Test:** the region is named "Recent changes" and focusable.
- [ ] T008 [US1] Add an admin section to `packages/e2e/src/scenarios/phone-width.e2e.ts`, at 375px, as a new administrator (`newUser(…, ['admin'])`), using `expectNoSidewaysScroll` and `expectOnScreen` from `helpers/viewport.ts` (G-01, research R-16):
  - **Categories:** create a category whose name is a unique 60-character word (`createCategory`); open `/categories`; check the page, then `expectOnScreen` on that row's Rename and Archive; press Rename and check the field, Save and Cancel.
  - **Reviews:** `createReviewedCourse`, then two `postReview`s, one 500 characters ending in a 70-character word; open `/reviews`, choose the course, check the page and its Remove buttons.
  - **Certificates:** `createRevokableCertificateViaApi` (T002); look it up; check the page and Revoke.
  - **Payments:** `connectLocalPayments`; open `/payments`; check the page.

  Call `screenshot()` on each. Until US7 merges, choose the course and look up the certificate through the controls, not the address.
- [ ] T009 [US1] Run `pnpm nx run @discava/admin-portal:test` (once), lint, typecheck and `pnpm nx run @discava/admin-portal:build`. Fix failures in the code.

---

## Phase 3: User Story 2 - Links, breadcrumbs and the home page lead somewhere real (Priority: P1)

**Goal**: No link or address leads to a bare "Not Found"; the trail starts with "Home"; the home page leads to every area.

**Independent test**: quickstart, US2.

- [ ] T010 [P] [US2] Test first in `AP/components/not-found-page.test.tsx`, then add `AP/components/not-found-page.tsx` and use it as the root route's `notFoundComponent` in `R/__root.tsx` and as `defaultNotFoundComponent` in `AP/router.ts` (A-06, research R-5). It calls `usePageTitle('Page not found')` and `useBreadcrumbLabel('Page not found')`, and renders an `h1` "Page not found", "There's no page at this address.", and a `Link to="/"` "Go to the home page". **Tests:** rendered for an unknown path, inside `AppLayout` (the sidebar's Home link is present), with one `h1` and the link.
- [ ] T011 [P] [US2] Test first in `R/-index.test.tsx`, then add Certificates, Payments and Branding cards to `areas` in `R/index.tsx`, in sidebar order, with Notification settings last and the descriptions in research R-14, and no figure (A-08). **Test (changes meaning, plan.md):** six cards, each linking to its route.
- [ ] T012 [US2] **Needs IP T016.** Extend the existing `AP/components/app-layout.test.ts` (rename it `.tsx` if it needs JSX). Its root-crumb `'/'` and `availableRoutes` assertions change meaning with IP T016 (plan.md); update them if IP T016 didn't. Then render `AppLayout` at `/settings/branding` and `/settings/notifications` with the admin route tree, and assert the trail is "Home", "Settings" as text (no link), then "Branding" or "Notification settings"; and that every crumb link's `href` matches an admin route (A-04, A-05). No source change is expected; if one is needed, it belongs in `SH/components/portal-shell.tsx` under IP T016, not here.
- [ ] T013 [US2] **Needs IP T016 and IP T021.** Extend `packages/e2e/src/scenarios/breadcrumbs.e2e.ts` with an admin case: as a new administrator, open Branding and check the trail ("Home", "Settings" not a link, "Branding"); follow "Home"; open `/no-such-page` and check the "Page not found" heading and its link home. `screenshot()` the not-found page.
- [ ] T050 [US2] Add `packages/e2e/src/scenarios/admin-portal.e2e.ts`: as a new administrator, open the home page and check its six cards each open their page; open `/no-such-page` and check the "Page not found" heading and its link home. `screenshot()` both. This doesn't wait on IP.
- [ ] T014 [US2] Run the admin portal's tests, lint, typecheck and build. Fix failures in the code.

---

## Phase 4: User Story 3 - Every page says where you are and what it is waiting for (Priority: P2)

**Goal**: Every tab has its page's name; every wait says what it is waiting for; focus follows navigation.

**Independent test**: quickstart, US3.

- [ ] T015 [US3] Call `usePageTitle` in every admin route, with the parts in [contracts/page-titles.md](./contracts/page-titles.md) (A-01):
  - `R/index.tsx`, `R/categories/-components/categories-screen.tsx`, `R/-components/reviews-screen.tsx`, `R/-components/certificates-screen.tsx`, `R/-components/payments-screen.tsx`, `R/settings/notifications.tsx`;
  - `R/settings/branding.tsx` changes to `usePageTitle('Branding', 'Settings')`;
  - `R/__root.tsx`'s restricted branch: a small `RestrictedPage` component, rendered only in that branch, calls `usePageTitle('Administrators only')` and renders `RestrictedPortal`. Never call it above `AdminsOnly`'s early return: a parent's effect runs after its children's, so it would overwrite every admin page's title on first load ([contracts/page-titles.md](./contracts/page-titles.md));
  - `AP/components/app-layout.tsx`: `segmentLabels.notifications` becomes "Notification settings", matching the title and `h1`.

  **Tests:** one per route's test file, asserting `document.title`; and in `R/-root.test.tsx`, an admin's page keeps its own title after first load, while a non-admin's is "Administrators only · Discava".
- [ ] T016 [US3] Use `LoadingState` (`@discava/common-shadcn/components/loading-state`) for every wait for a page or section (A-07, A-10, research R-6):
  - `AP/main.tsx`: the `RuntimeConfigProvider` and `BrandProvider` fallbacks become `<LoadingState size="page" label="Loading Discava…" />`; `CognitoAuth` gets `fallback={<LoadingState size="page" label="Signing you in…" />}` (T001);
  - categories: "Loading the categories…"; reviews: "Loading the courses…" and "Loading the reviews…"; certificates: "Looking up the certificate…"; payments: "Loading the payment settings…"; branding's hand-built "Loading…" becomes `LoadingState` "Loading the branding…".
  - The courses list and the reviews list get `aria-busy` while `isFetchingNextPage`.

  **Tests:** each screen's loading state shows its sentence in a `status` region, under the page's `h1`.
- [ ] T017 [US3] **Needs IP T032.** Test first in `AP/components/app-layout.test.ts(x)`: after navigating from `/` to `/payments`, the "Payments" `h1` has focus (A-02). No source change is expected.
- [ ] T051 [US3] Extend `packages/e2e/src/scenarios/admin-portal.e2e.ts`: visit each admin page and assert its tab title ([contracts/page-titles.md](./contracts/page-titles.md)); `screenshot()` Categories while its list request is held (`page.route` delaying `localhost:2025`), showing "Loading the categories…".
- [ ] T018 [US3] Run the admin portal's and `common-shadcn`'s tests, lint, typecheck and build. Fix failures in the code.

---

## Phase 5: User Story 4 - The keyboard keeps its place (Priority: P2)

**Goal**: After every action focus is on the control used or what replaced it, never on `<body>`, and each result is announced once.

**Independent test**: quickstart, US4.

- [ ] T019 [P] [US4] Replace `disabled={…isPending}` with `PendingButton` and the labels in research R-7's table (B-06, C-02, E-02, F-03):
  - categories: Add category, Rename's Save, the confirmation's Archive;
  - reviews: Remove review, Load more and More courses ("Loading more…"), and the two Try again buttons until T031 replaces them;
  - certificates: Revoke certificate, Restore certificate (Look up starts no mutation; research R-7);
  - payments: Connect Stripe and Save key (in `R/-components/payments/connect-form.tsx`, through a new `pending` prop); Disconnect on `status-card.tsx` shows "Disconnecting…" while the disconnect runs (the confirmation closes before it starts). Replace key and Disconnect stay `disabled` while `changing` and use `aria-disabled` while the admin's own request runs;
  - branding: Save (its spinner goes; the label says "Saving…"), and each image's Reset to default while its upload runs (F-09, in `R/settings/-components/image-field.tsx`).

  **Tests (change meaning, plan.md):** in each screen's test, a pending button has `aria-disabled="true"`, keeps focus, and a second press sends nothing. Replace `toBeDisabled()` assertions about pending buttons with these; keep `payments-screen.test.tsx`'s `toBeDisabled()` for the `changing` state, which is still `disabled`. In `packages/e2e/src/scenarios/branding.e2e.ts`, a Save that is pending is no longer `toBeDisabled()`; leave its unchanged/invalid assertions to T033.
- [ ] T020 [US4] Test first in `categories-screen.test.tsx`, then in `categories-screen.tsx` (B-07, B-08, research R-8):
  - Rename focuses its field; Escape in the field cancels the rename;
  - after Save or Cancel, focus moves to that row's Rename (a `Map` of Rename buttons by id, filled by ref callbacks, focused after the list has refetched);
  - the Archive confirmation gets `useReturnFocus(open)`'s `onCloseAutoFocus`; after archiving, focus moves to the row's Rename.
- [ ] T021 [US4] Test first in `reviews-screen.test.tsx`, then in `reviews-screen.tsx` (C-05, C-06):
  - the Remove dialog gets `useReturnFocus`; after a removal, focus moves to the review's `li` (`tabIndex={-1}`, `aria-label` "Review by <name>"), which now says "Removed";
  - after Load more or More courses, focus moves to the first item it added, or, when it added none, to the list itself (`tabIndex={-1}`, named "Reviews", or the picker).
- [ ] T022 [US4] Test first in `certificates-screen.test.tsx`, then in `certificates-screen.tsx` (D-03): both dialogs get `useReturnFocus`; after a revoke, focus moves to Restore, and after a restore, to Revoke.
- [ ] T023 [US4] Test first in `payments-screen.test.tsx`, then in `payments-screen.tsx` and `payments/connect-form.tsx` (E-03): both dialogs get `useReturnFocus`; Replace key's Cancel focuses Replace key; Go back ("Keep the current key" after T042) and a failed save focus the key field, and a failed save's alert adds "Enter the key again to retry."; a successful connect or replace focuses the status card's Replace key; a successful disconnect focuses the key field (research R-8).
- [ ] T024 [US4] Test first in `R/settings/-branding.test.tsx`, then in `R/settings/-components/branding-form.tsx` (F-07): the Reset-all confirmation gets `useReturnFocus`.
- [ ] T025 [US4] Test first, then announce each result with one `StatusMessage` (`@discava/common-shadcn/components/status-message`) per screen, with the sentences in research R-9 (B-09, C-05, D-03, E-04, F-05):
  - categories, reviews, certificates, payments, and branding (whose visible "Branding saved" alert stays, and is no longer the announcement);
  - the reason and note counters lose `aria-live`; each field gets `aria-describedby` with its counter's id (C-08, D-09).

  **Tests:** after each action the `status` region holds its sentence; the counters have no `aria-live`.
- [ ] T052 [US4] Extend `packages/e2e/src/scenarios/admin-portal.e2e.ts`: with the keyboard alone, rename a category (Rename, type, Enter) and archive another; after each, assert focus is on that row's Rename. `screenshot()` the list after the archive.
- [ ] T026 [US4] **Needs IP T040.** Test first in `AP/components/app-layout.test.ts(x)`: at a phone width (mock `useIsMobile`), choosing a page in the sidebar closes it; Escape returns focus to the sidebar button (A-03). No source change is expected.
- [ ] T027 [US4] (human) With a screen reader (NVDA or VoiceOver), do the actions in [quickstart.md](./quickstart.md) US4. Confirm each result is announced once, focus is where the table says, and the counters are quiet. Note anything else in the pull request.
- [ ] T028 [US4] Run the admin portal's tests, lint, typecheck and build. Fix failures in the code.

---

## Phase 6: User Story 5 - Typed work is never lost by accident (Priority: P2)

**Goal**: A typed reason or note is lost only by Cancel; leaving Branding asks with the portal's own dialog.

**Independent test**: quickstart, US5.

- [ ] T029 [US5] **Needs IP T051 and IP T052.** Test first, then (C-04, D-04, F-04, research R-10):
  - in `reviews-screen.tsx` and `certificates-screen.tsx`, use `useDiscardGuard({ dirty, discard: close })` in the Remove review and Revoke dialogs, `dirty` being a non-empty trimmed reason or note. Spread `contentProps` on `DialogContent`, use `requestClose` for the Close button, render `confirmation` once inside the dialog; Cancel keeps calling `close`;
  - in `branding-form.tsx`, replace the `useBlocker` call with `useUnsavedChangesGuard(dirty)` and render its `confirmation` once.

  **Tests (change meaning for branding, plan.md):** Escape with a reason typed opens "Discard unsaved changes?"; Keep editing returns to the field with the text; with nothing typed Escape closes; Cancel then reopen shows an empty field; branding with a change asks "Leave without saving?" on a link, and doesn't call `window.confirm`.

  Extend `packages/e2e/src/scenarios/admin-portal.e2e.ts`: type a reason in Remove review, press Escape, and `screenshot()` the question.
- [ ] T030 [US5] Run the admin portal's tests, lint, typecheck and build. Fix failures in the code.

---

## Phase 7: User Story 6 - Errors and blocked actions say what to do next (Priority: P2)

**Goal**: Every failed load has one Try again; every error sits where the action was; no submit button is disabled to mean "not ready".

**Independent test**: quickstart, US6.

- [ ] T031 [US6] Use `ErrorAlert type="error"` with a `header` and `onRetry={() => query.refetch()}` for every failed load (B-03, C-02, D-02, E-05, research R-11):
  - categories: "Couldn't load the categories";
  - reviews: "Couldn't load the courses" and "Couldn't load the reviews", replacing both hand-built blocks;
  - payments: move the hand-built Try again from the alert's text to `onRetry`;
  - certificates: a failed lookup (not "not found") is "Couldn't look up the certificate", with Try again.

  **Tests (change meaning, plan.md):** each failed load shows one alert with its header and one Try again, which refetches.
- [ ] T032 [US6] Test first, then split the categories screen's single alert by action (B-04, research R-11):
  - Add's error shows under the add form, headed "Couldn't add the category", tied to the field (`aria-describedby`, `aria-invalid`);
  - Rename's shows under the row's rename form, headed "Couldn't rename the category", tied to its field;
  - Archive's shows inside the confirmation: `onSettled` no longer closes it; `onSuccess` does.

  **Tests (change meaning):** a duplicate name's message is beside the add field, not above the form; a failed archive keeps the confirmation open with the error inside.
- [ ] T033 [US6] Test first, then make every submit button enabled and check on submit, as research R-12's table says (B-05, C-03, D-05, E-06, F-03):
  - categories (Add, Rename), certificates (Look up, Revoke with "Other"), reviews (Remove review), payments (`KeyForm`), branding (invalid name or colour; nothing changed announces "Nothing to save: the branding is as saved.");
  - each problem is shown beside its field with an `id`, tied with `aria-describedby` and `aria-invalid`, and focus moves to the field. Nothing is sent.

  **Tests (change meaning, plan.md):** each button is enabled; submitting empty shows the message, focuses the field, and the fake API records no call. Update `packages/e2e/src/scenarios/branding.e2e.ts` (Save `toBeDisabled()` at lines 54, 63, 88, 210, 300) and `review.e2e.ts` (Remove review `toBeDisabled()` at lines 169-170) to submit and assert the message instead.
- [ ] T034 [US6] Test first, then show a certificate that isn't found as `ErrorAlert type="info"` headed "No certificate has this ID", with "Check the ID against the certificate's page or PDF. IDs look like 7V0Y-TKB5-6T6K-RPB3." and no Try again (D-02). **Test (changes meaning):** replaces the "Certificate not found" assertion.
- [ ] T035 [US6] **Needs IP T059.** Test first in `R/settings/-route.test.tsx`: a failed toggle shows `apiErrorMessage`'s sentence, never "Failed to fetch", and a failed load has Try again (F-01). No admin source change is expected.
- [ ] T053 [US6] Extend `packages/e2e/src/scenarios/admin-portal.e2e.ts`: add a category with an empty name, then one whose name exists; assert each message is under the add field, which has focus. `screenshot()` the duplicate-name message.
- [ ] T036 [US6] Run the admin portal's tests, lint, typecheck and build. Fix failures in the code.

---

## Phase 8: User Story 7 - Views can be shared and come back to (Priority: P3)

**Goal**: The chosen course on Reviews and the looked-up certificate live in the address.

**Independent test**: quickstart, US7.

- [ ] T037 [P] [US7] Test first, then add `validateSearch` for `course` to `R/reviews.tsx`, as [contracts/url-state.md](./contracts/url-state.md) says, and make `ReviewsScreen` read and write it in place of `useState` (C-07, research R-13). When the id isn't among the loaded courses, the picker shows one selected option, "The course from the link". **Tests:** opening `/reviews?course=c1` requests `review.list` for `c1` once; choosing another course pushes its id; Back restores the first; an unknown id shows the extra option; an empty or 101-character `course` is dropped from the address with `replace`.
- [ ] T038 [P] [US7] Test first, then add `validateSearch` for `id` to `R/certificates.tsx`, and make `CertificatesScreen` read it in place of `lookedUp`, with the field kept in step, Back included (D-06). **Tests:** opening `/certificates?id=ABCD` requests `certificate.get` for it once and fills the field; Look up pushes the trimmed id; an empty or 101-character `id` is dropped from the address with `replace`.
- [ ] T039 [US7] Add a case to `packages/e2e/src/scenarios/phone-width.e2e.ts`'s admin section, or a new `admin-views.e2e.ts` if it reads better: choose a course on Reviews and look up a certificate, reload each, and check the same view shows; press Back and check the previous one. Then change T008's admin cases to open `?course=` and `?id=` directly. `screenshot()` each restored view.
- [ ] T040 [US7] Run the admin portal's tests, lint, typecheck and build. Fix failures in the code.

---

## Phase 9: User Story 8 - Controls are big enough and say what they are (Priority: P3)

**Goal**: Every control is at least 24px and named for what it acts on.

**Independent test**: quickstart, US8.

- [ ] T041 [P] [US8] Test first, then name the controls (B-10, B-11, D-07, F-06, A-09, research R-14, R-15):
  - categories: `aria-label` "Rename <name>" and "Archive <name>"; the placeholder becomes "Science…";
  - branding: `ImageField` takes a `resetLabel`, and `branding-form.tsx` passes "Reset the logo to default", "Reset the icon to default", "Reset the share image to default" (visible text too);
  - certificates: the ID field gets `spellCheck={false}`, `autoComplete="off"`, `autoCapitalize="characters"`;
  - home: each card's `Link` is `aria-labelledby` its title and `aria-describedby` its description and figure.

  **Tests (change meaning, plan.md):** the new names; each contains its visible text.
- [ ] T042 [P] [US8] Test first in `payments-screen.test.tsx`, then rename the replace confirmation's buttons to "Replace the key" and "Keep the current key" (E-07), and update `packages/e2e/src/scenarios/payment-connection.e2e.ts`, which finds "Continue" (plan.md), adding `screenshot()` of the renamed confirmation. This is the phase's screenshot when T043 waits on IP.
- [ ] T043 [US8] **Needs IP T073 and IP T074.** In `packages/e2e/src/scenarios/phone-width.e2e.ts`'s admin section, measure the Remove review dialog's close button and Branding's "Show the name beside the logo" switch: each at least 24×24px; clicking the switch's text toggles it (C-09, F-02, F-08). No admin source change is expected.
- [ ] T044 [US8] Run the admin portal's tests, lint, typecheck and build. Fix failures in the code.

---

## Phase 10: User Story 9 - The rules and the tests cover the admin portal (Priority: P3)

**Goal**: The UI rules say how a table fits a phone; the e2e suite fails when an admin page doesn't.

**Independent test**: the bullet is in `packages/websites/CLAUDE.md`; reverting T004 locally makes the admin phone-width case fail.

- [ ] T045 [US9] Add the bullet in [contracts/ui-rules.md](./contracts/ui-rules.md) to "Layout" in `packages/websites/CLAUDE.md` (FR-031). Read it against the bullets the instructor-portal spec adds (its T084) and the root `CLAUDE.md`, and remove anything said twice. Run `pnpm lint` and `graphify update .`.
- [ ] T046 [US9] (human) Confirm the e2e admin cases from T008 and T013 fail when their fix is reverted (FR-032): on a local branch, revert T004's classes, run `pnpm nx e2e @discava/e2e -- phone-width` against `pnpm dev`, and note the failure in the pull request.

---

## Phase 11: Polish - the whole portal, by hand

**Goal**: Confirm on a running stack what tests cannot.

- [ ] T047 (human) With all phases merged, walk [quickstart.md](./quickstart.md) at 375px and 1440px on the local stack, saving screenshots to `tmp/screenshots/pr-<number>/`. Compare the network panel with `main` on Categories, Reviews, Certificates and Payments: the same requests, in the same order (FR-028). Check the stacked categories table with a screen reader in Safari and Chrome: each row reads its name, slug, status and course count, in that order.
- [ ] T048 (human) On a real phone, or the browser's device mode with touch: rename and archive a category, remove a review, revoke a certificate (SC-003). At 1440px with text zoom at 200%, confirm no admin page scrolls sideways.
- [ ] T049 Record in `spec.md`'s Assumptions, as a dated note, anything the walk found that this spec left out of scope, so that the next audit starts from it. Do not widen this feature.

---

## Dependencies

- **Phase 1 first.** T001 is used by Phase 4 (T016); T002 by Phase 2 (T008).
- **The instructor-portal spec ("IP").** These tasks check shared changes IP makes, and wait for them as "Organization" says:

  | Task | Needs | What it checks |
  |------|-------|----------------|
  | T012, T013 | IP T016 (and T021 for the e2e file) | breadcrumbs |
  | T017 | IP T032 | focus after navigation |
  | T026 | IP T040 | the phone sidebar |
  | T029 | IP T051, T052 | the discard and leave guards |
  | T035 | IP T059 | notification settings' errors |
  | T043 | IP T073, T074 | 24px close buttons and switches |

  Every other task depends only on what is on `main` since #892.
- **Files several phases touch.** Whichever merges second rebases:
  - **US1 and US4, US6:** Phases 2, 5 and 7 all edit `categories-screen.tsx`, `reviews-screen.tsx` and `certificates-screen.tsx`. Merge 2 first.
  - **US4 and US6:** T019 and T033 both change the same buttons (`PendingButton`, then enabled-with-checks). Merge 5 first.
  - **US4 and US5:** T021, T022 and T029 edit the same two dialogs.
  - **US2 and US8:** T011 and T041 both edit `R/index.tsx`.
  - **US1 and US7:** T039 changes T008's cases.
  - **US2, US3 and US7:** Phases 3 and 4 both edit `R/index.tsx` and `R/__root.tsx`; Phases 4 and 8 both edit the reviews and certificates screens.
  - **The new `admin-portal.e2e.ts`:** T050 creates it; T051, T052, T029 and T053 extend it. Whichever phase merges first after Phase 3 rebases the others.
- **Phase 10 (US9)** may merge any time after Phase 2.
- **Within a phase,** tasks marked [P] touch different files.

## Requirement coverage

| Requirement | Tasks |
|-------------|-------|
| FR-001 no sideways scroll or off-screen controls | T004, T005, T006, T007, T008 |
| FR-002 tables at phone width | T004, T007 |
| FR-003 user-written text wraps | T004, T005, T006 |
| FR-004 breadcrumbs | T012, T013 (IP T016) |
| FR-005 not-found page | T010, T013, T050 |
| FR-006 home leads everywhere | T011, T050 |
| FR-007 titles, one h1, one main | T010, T015, T016, T051 |
| FR-008 focus on navigation | T017 (IP T032) |
| FR-009 waits in words | T001, T016, T019 |
| FR-010 busy controls keep focus | T019 |
| FR-011 focus after removal or swap | T020, T021, T022, T023, T052 |
| FR-012 focus after closing; sidebar | T020, T021, T022, T023, T024, T026 (IP T040) |
| FR-013 results announced once; quiet counters | T025 |
| FR-014 Rename focus and Escape | T020 |
| FR-015 failed action keeps input | T029, T032, T033 (as today for the dialogs; asserted) |
| FR-016 Cancel resets | T029 |
| FR-017 dismissal asks | T029 (IP T051) |
| FR-018 leaving Branding asks | T029 (IP T052) |
| FR-019 error sentences | T031, T035 (IP T059) |
| FR-020 one Try again | T031 |
| FR-021 errors where you look | T032 |
| FR-022 problems by fields; no disabled submit | T033, T053 |
| FR-023 lookup finds nothing | T034 |
| FR-024 views in the address | T037, T038, T039 |
| FR-025 24px targets | T043 (IP T073, T074) |
| FR-026 names | T011, T041, T042 |
| FR-027 code fields | T041 |
| FR-028 no request changes | the rules for every task; T047 |
| FR-029 text-only buttons | the rules for every task |
| FR-030 shared fixes once, in shared code | T001; the IP-dependent tasks above |
| FR-031 the table rule | T045 |
| FR-032 e2e fails on the admin defects | T008, T013, T046, T050 |

SC-003 (a phone task start to finish) and the 200% zoom edge case are checked by hand in T048.

## Parallel example

After Phase 2 merges, three agents can work at once, touching different files:

- **Phase 3 (US2):** the not-found page, the router and the home cards.
- **Phase 8 (US7):** the reviews and certificates routes' search params.
- **Phase 10 (US9):** the rules.

Phase 4 (US3) touches files of both Phase 3 and Phase 8 (`R/index.tsx`, `R/__root.tsx`, the screens), so it follows them.

## Implementation strategy

- **First, the P1 slice: Phases 1 to 3.** These make the three broken pages usable on a phone and stop links leading to a bare "Not Found". Ship them first.
- **Next, Phases 4 to 7.** These make the portal usable with a keyboard and a screen reader, keep typed work, and put errors where they belong.
- **Last, Phases 8 to 10,** which are polish and prevention. Phase 11 is the final walk.
