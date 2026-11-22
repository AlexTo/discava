# Research: Admin Portal UX Fixes

Each decision names the files it was read from and the findings in [audit.md](./audit.md) it answers. The measurements come from the audit (local stack, 1440px and 375px, 2026-11-23); its screenshots are in the git-ignored `tmp/screenshots/admin-portal-audit/`. Paths are relative to `packages/websites/admin-portal/src/` unless they start with `packages/`. "IP" means the [instructor-portal UX fixes](../20261123-000428-instructor-portal-ux-fixes/research.md), whose decisions this feature reuses rather than restates.

## R-1: The categories table at phone width

**Answers**: B-01, B-02.

**Decision**: Keep one `<table>` in `routes/categories/-components/categories-screen.tsx`, and stack it below `sm` with CSS only:

- `table`, `tbody`, `tr` and `td` get `max-sm:block`; `thead` gets `max-sm:sr-only`;
- each `tr` becomes a grid below `sm` with named areas, in the columns' DOM order (Name, Slug, Status, Courses, actions): `max-sm:grid max-sm:grid-cols-[auto_minmax(0,1fr)] max-sm:gap-x-3 max-sm:gap-y-1 max-sm:py-3 max-sm:[grid-template-areas:'name_name'_'slug_slug'_'status_count'_'actions_actions']`, and each `td` takes its area (`max-sm:[grid-area:name]`, …). Status and the course count share one line; nothing is reordered, so a screen reader reads a stacked row in the same order as a table row;
- the name cell is `min-w-0 break-words [overflow-wrap:anywhere]`, at full width;
- the slug and the course count are each preceded by a label shown only below `sm` (`<span className="sm:sr-only">Slug: </span>`, "Courses: "), so the value keeps its meaning without the hidden header;
- the slug is `break-all`, since it is a code with no spaces;
- the actions cell is `max-sm:text-left`, and its button group `flex flex-wrap gap-2 max-sm:justify-start`.

At `sm` and up the table is unchanged, apart from `break-words` on the name and `break-all` on the slug, which stop a long word running into the next column (B-02).

The rename form in the name cell becomes `flex flex-wrap gap-2`, with the field `min-w-0 flex-1 basis-40`, so Save and Cancel wrap below a narrow field rather than squeezing it.

**Rationale**: The table has five columns and no wrapper, so its minimum width is the sum of its longest unbreakable cells: the 60-character name, the 70-character slug, and two buttons. At 375px it is 1,003px, and every action is beyond the edge. Stacking keeps every action on screen with one tap. One `<table>` keeps one set of buttons in the DOM, so the component tests and e2e helpers find the same names at either width.

Safari drops table semantics from a `display: block` table. The stacked rows add the visible labels, so the content still reads in order; the screen-reader check in Polish confirms it at both widths.

**Alternatives considered**:

- A sideways-scrolling table (`overflow-x-auto`) puts Rename and Archive a scroll away on every row: the defect, one step removed.
- A separate card list below `sm` doubles every control in the DOM and every query in the tests.
- Hiding the slug on phones hides information an administrator needs to tell two categories apart.

## R-2: Long text on Reviews and Certificates

**Answers**: C-01, D-01, D-08.

**Decision**:

- **Reviews** (`routes/-components/reviews-screen.tsx`): the review text, the response text and the removal reason get `break-words [overflow-wrap:anywhere]`; the reviewer's name line and the response heading get `min-w-0 break-words`. The header row (`flex items-start justify-between`) becomes `flex flex-wrap`, so Remove wraps below a long name.
- **Certificates** (`routes/-components/certificates-screen.tsx`): the card's header row becomes `flex flex-wrap items-start gap-3`; the details block is `min-w-0 flex-1 basis-full break-words sm:basis-0`, so Revoke or Restore sits below it on a phone and beside it from `sm`. The certificate ID is `break-all`.
- **History**: each entry is its own `li` with `space-y-2` between entries and the note on its own line (`block break-words`), so a 500-character note doesn't run into the next entry.

**Rationale**: Neither screen gives user-written text anything to break on. `whitespace-pre-line` keeps the author's line breaks but not a long word, and the flex rows' text children have no `min-w-0`, so they refuse to shrink below their longest word. This is IP R-12's pattern on two more screens.

## R-3: The Recent changes table on Payments

**Answers**: E-01.

**Decision**: In `routes/-components/payments/changes-table.tsx`:

- wrap the table in `<div role="region" aria-labelledby="recent-changes" tabIndex={0} className="overflow-x-auto">`, so it scrolls within itself and a keyboard user can scroll it;
- give the cells `px-2 first:pl-0 last:pr-0` and the table `min-w-[36rem]`, so the columns never run together;
- the When cell is `whitespace-nowrap tabular-nums`; the key ending is `whitespace-nowrap`.

**Rationale**: The table is read-only, so scrolling inside it hides no action, and it keeps the columns that compare changes side by side. It matches IP's earnings tables (IP R-12, FR-007 there).

## R-4: Breadcrumbs, the route announcer and the phone sidebar

**Answers**: A-02, A-03, A-04, A-05.

**Decision**: No admin-portal change. IP T016 (breadcrumbs: "Home", text crumbs for routes that don't exist), IP T032 (`RouteAnnouncer` in `PortalShell`) and IP T040 (the phone sidebar closes on navigation and returns focus on Escape) fix the shared `packages/common/shadcn/src/components/portal-shell.tsx`, which `components/app-layout.tsx` uses unchanged. After them:

- "Settings" has no route in the admin route tree, so it is rendered as text;
- `segmentLabels` already names every admin segment.

This feature adds the admin checks: a component test for the admin trail on `/settings/branding`, and an admin case in the e2e breadcrumbs scenario.

**Rationale**: The cause is in the shared shell. Fixing it again in the admin portal would fork the shell (FR-030).

## R-5: The not-found page

**Answers**: A-06.

**Decision**: Add a `notFoundComponent` to the root route in `routes/__root.tsx`, and set `defaultNotFoundComponent` in `router.ts` to the same component, `components/not-found-page.tsx`:

- it calls `usePageTitle('Page not found')` and `useBreadcrumbLabel('Page not found')`;
- it renders an `h1` "Page not found", the sentence "There's no page at this address.", and a `Link to="/"` "Go to the home page".

The root route's component renders `AppLayout` around its `Outlet`, so the not-found page shows inside the shell, with the sidebar, for administrators. A non-administrator gets the restricted page, as for every address today.

**Rationale**: The router's built-in fallback is the bare "Not Found" text the audit saw. IP T018 does the same for the instructor portal in its layout route; the admin portal has no layout route, so the root route holds it.

## R-6: Page titles, headings and waiting in words

**Answers**: A-01, A-07, A-10.

**Decision**:

- **Titles:** every route calls `usePageTitle` from its first render, with the parts in [contracts/page-titles.md](./contracts/page-titles.md). `RestrictedPortal`'s admin use passes a title through a `usePageTitle` call in `AdminsOnly`.
- **First load** (`main.tsx`): the `RuntimeConfigProvider` and `BrandProvider` fallbacks become `<LoadingState size="page" label="Loading Discava…" />`.
- **Sign-in redirect:** `CognitoAuth` (`packages/common/shadcn/src/components/cognito-auth.tsx`) renders a bare `<Spinner />` while `autoSignIn` redirects, and takes no prop to change it. It gains an optional `fallback?: React.ReactNode`, defaulting to today's `<Spinner />`, so no other portal changes until it passes one. The admin portal passes `<LoadingState size="page" label="Signing you in…" />`. IP T037 names the same wait for the instructor portal; whichever task lands first adds the prop, and the other uses it.
- **Loading:** every bare `<Spinner />` that stands for a page's or section's content becomes `LoadingState` with a sentence: "Loading the categories…", "Loading the courses…", "Loading the reviews…", "Looking up the certificate…", "Loading the payment settings…". The region gets `aria-busy` while a list redraws (Load more, More courses).
- **Headings:** every page already has one `h1` and one `main` in every state the audit saw (the `main` is `SidebarInset`'s). The rule is kept by tests: each route's test asserts one `h1` in its loading and error states.

**Rationale**: `usePageTitle`, `RouteAnnouncer` and `LoadingState` exist and are tested (#892, the student-portal feature). Only Branding uses the first.

## R-7: Keeping focus while an action runs

**Answers**: B-06, C-02 (Try again), E-02, F-03 (saving), F-09.

**Decision**: Replace every `disabled={…isPending}` on a button that starts the action with `PendingButton` (`@discava/common-shadcn/components/pending-button`), with a `pendingLabel`:

| Screen | Button | `pendingLabel` |
|--------|--------|----------------|
| Categories | Add category | "Adding…" |
| Categories | Rename's Save | "Saving…" |
| Categories | Archive (in the confirmation) | "Archiving…" |
| Reviews | Remove review | "Removing…" (today's label, kept) |
| Certificates | Revoke certificate, Restore certificate | "Revoking…", "Restoring…" (kept) |
| Payments | Connect Stripe, Save key | "Connecting…", "Saving…" |
| Payments | Disconnect, on the status card (the confirmation closes before the request starts, and focus returns here) | "Disconnecting…" |
| Reviews | Load more, More courses | "Loading more…" |
| Branding | each image's Reset to default, while its upload runs | (no label change; `aria-disabled`) |
| Branding | Save | "Saving…" (kept, without the spinner) |

`KeyForm`'s field stays `disabled` while busy: it isn't the focused control, and its value must not change mid-request. Replace key and Disconnect on the status card stay `disabled` while a change is in progress (`changing`), because the reason is stated in the "A change is in progress" alert above them; while the admin's own request runs they use `aria-disabled` through `PendingButton`.

Look up is not in the table: it starts no mutation, and the lookup's query lives in the child `Certificate`. While it runs, `LoadingState` says "Looking up the certificate…" (R-6); Look up's only `disabled` is for an empty field, which R-12 removes.

The branding image field's file input keeps `disabled` while its upload runs (choosing another file mid-upload would race it); its Reset button becomes a `PendingButton` so focus on it survives. The file input loses focus only if it had it, and the upload's `role="status"` "Uploading…" says what is happening (F-09).

**Rationale**: As IP R-5 found, a focused button set `disabled` sends focus to `<body>`. `PendingButton` keeps it focused and in the tab order, ignores presses, and says what it is doing.

## R-8: Focus after a control removes or swaps itself, and on dialog close

**Answers**: B-07, B-08, C-05, C-06, D-03, E-03, F-07.

**Decision**:

- **Dialogs opened from state** (Remove review, Revoke, Restore, Disconnect, Replace confirmation, Reset all, Archive): pass `useReturnFocus(open)`'s `onCloseAutoFocus` to the `DialogContent` or `AlertDialogContent`. On Cancel or Escape, focus returns to the button that opened the dialog.
- **When that button is gone afterwards**, the screen moves focus itself, after the list has redrawn (in the mutation's `onSuccess`, after `await` of the refetch, through a ref map keyed by id):
  - **Archive:** to the same row's Rename (the row stays, without Archive).
  - **Remove review:** to the removed review's row (`tabIndex={-1}` on the `li`, named by its reviewer), which now says "Removed".
  - **Revoke / Restore:** to the button that replaced it (Restore / Revoke).
  - **Rename Save and Cancel:** to the row's Rename button.
  - **Replace key Cancel:** to Replace key.
  - **The confirmation's Go back:** to the key field, now empty, with the existing rule that a key is never kept (spec Assumptions).
  - **Connect Stripe and Save key succeeding:** the form gives way to the status card; focus moves to its Replace key.
  - **Disconnect succeeding:** the status card gives way to the key form; focus moves to its key field.
  - **A failed connect or save:** to the key field, now empty; the alert adds "Enter the key again to retry."
  - **Load more / More courses:** to the first item it loaded, or, when it loaded none (the last page was empty), to the list itself (`tabIndex={-1}`, named "Reviews" or by the picker's label).
- **Rename** focuses its field on open (`autoFocus` on the field, which is the single primary input of that moment) and cancels on Escape (`onKeyDown`).

**Rationale**: Every one of these dialogs is controlled with `open` state and no `DialogTrigger`, so Radix has nothing to return focus to. Every swap unmounts the focused button. These are IP R-6's two causes, and IP R-6's two remedies.

## R-9: Announcing results, and quiet counters

**Answers**: B-09, C-05, C-08, D-03, D-09, E-04, F-05.

**Decision**:

- One `StatusMessage` per screen, mounted from the first render, says what happened: "Science added.", "Renamed to Science.", "Science archived.", "Review removed.", "Certificate revoked.", "Certificate restored.", "Stripe connected.", "Key replaced.", "Stripe disconnected.", "Branding saved. Visitors see it within 5 minutes."
- Branding's visible "Branding saved" alert stays as the visible confirmation; the announcement moves to the `StatusMessage` (F-05).
- The reason and note counters lose `aria-live`, and the field gains `aria-describedby` pointing at the counter, so the count is read when the field is focused, not on every keystroke.

**Rationale**: IP R-14. A status region that mounts with its text may not be announced; a live counter speaks on every key.

## R-10: Typed reasons and notes, and leaving Branding

**Answers**: C-04, D-04, F-04.

**Decision**:

- **Remove review, Revoke certificate:** use `useDiscardGuard({ dirty, discard })` (IP T051, `packages/common/shadcn`), with `dirty` true when the reason or note is not empty. Its `contentProps` go on `DialogContent`, and `requestClose` on the Close button. Cancel keeps calling the dialog's `close` directly, which already resets.
- **Branding:** replace `useBlocker({ shouldBlockFn: … window.confirm … })` with `useUnsavedChangesGuard(dirty)` (IP T052), rendering its `confirmation` once in the form. Closing or reloading the tab keeps the browser's prompt, which the hook enables.

**Rationale**: Both dialogs already keep input on a failed request and reset on Cancel; only dismissal loses work. The shared hooks give every portal one wording and one behaviour.

**Dependency**: both hooks come from IP Phase 7. The admin task that uses them waits for it (tasks.md Dependencies).

## R-11: Errors in the right place, with a way to retry

**Answers**: B-03, B-04, C-02, D-02, E-05, F-01.

**Decision**:

- **Failed loads:** every one is an `ErrorAlert type="error"` with a `header` and `onRetry={() => query.refetch()}`:
  - Categories' list (B-03): "Couldn't load the categories";
  - Reviews' courses and reviews (C-02): "Couldn't load the courses", "Couldn't load the reviews", replacing the hand-built blocks;
  - Payments' status (E-05): the hand-built button in the alert's text moves to `onRetry`;
  - a failed certificate lookup (D-02): "Couldn't look up the certificate". Its query keeps `retry: false`, so Try again is the only retry.
- **Not found** (D-02): `ErrorAlert type="info"` (a status, not an alert), headed "No certificate has this ID", with "Check the ID against the certificate's page or PDF. IDs look like 7V0Y-TKB5-6T6K-RPB3." and no Try again.
- **Categories' actions** (B-04): the one `error` alert splits by action:
  - Add's error shows under the add form, headed "Couldn't add the category", tied to the field with `aria-describedby` and `aria-invalid`;
  - Rename's shows under the row's rename form, tied to its field, headed "Couldn't rename the category";
  - Archive's shows inside the confirmation, which stays open: `onSettled` no longer closes it, `onSuccess` does.
- **Notification settings** (F-01): IP T059 fixes the shared `NotificationPreferences`. This feature adds the admin route's test.

**Rationale**: `ErrorAlert` already has `onRetry`, and `apiErrorMessage` already turns network failures into a sentence; the admin portal uses the second everywhere and the first nowhere. The single alert on Categories is shared by three mutations because `error = create.error ?? rename.error ?? archive.error`; splitting it puts each where the action was taken (IP R-9).

## R-12: Buttons no longer disabled to mean "not ready"

**Answers**: B-05, C-03, D-05, E-06, F-03 (invalid or unchanged).

**Decision**: Each submit button stays enabled. On submit, the form checks itself in the browser, shows the problem next to its field, ties it with `aria-describedby` and `aria-invalid`, and focuses the field. Nothing is sent:

| Form | Check | Message |
|------|-------|---------|
| Add category, Rename | empty after trimming | "Enter a name for the category." |
| Certificate lookup | empty after trimming | "Enter a certificate ID." |
| Remove review | empty reason | "Enter a reason. It's kept on record with the removal." |
| Revoke certificate | "Other" with an empty note | "Enter a note to say why." |
| Stripe key | empty | "Enter a Stripe secret key." |
| Branding | invalid name or colour | the existing messages, now also on submit, with focus moved to the first |
| Branding | nothing changed | Save stays enabled; pressing it announces "Nothing to save: the branding is as saved." in the `StatusMessage` and sends nothing |

The server's own checks are unchanged and still answer the same requests.

**Rationale**: A disabled button can't be focused, can't say why, and gives no feedback when pressed (the Web Interface Guidelines' "submit stays enabled until the request starts"). The checks are those the buttons' `disabled` expressions already make, moved to submit, so no request changes (FR-028).

## R-13: Views in the address

**Answers**: C-07, D-06.

**Decision**: `routes/reviews.tsx` and `routes/certificates.tsx` gain `validateSearch` (zod), as [contracts/url-state.md](./contracts/url-state.md) says:

- **Reviews `?course=`:** the select writes it (`navigate({ search, replace: false })`), and `ReviewsScreen` reads it in place of `useState`. `CourseReviews` makes the same `review.list` request for that id. When the id isn't among the loaded options, the select shows one extra option for it, "The course from the link", so the picker matches the address; "More courses" may later load its title, at which point the extra option goes.
- **Certificates `?id=`:** Look up writes it (push), and the screen reads it; the field is initialised from it and kept in step on Back.

**Rationale**: IP R-10's pattern. The requests are those the controls make today, with the same inputs.

## R-14: Home lists every area, named by its title

**Answers**: A-08, A-09.

**Decision**: In `routes/index.tsx`, `areas` gains Certificates ("Look up a certificate to revoke or restore it."), Payments ("Connect the Stripe account students pay into.") and Branding ("Set the platform's name, logo, icon and colour."), in sidebar order, with Notification settings last. None has a figure. Each card's `Link` is named by its title (`aria-labelledby` the `CardTitle`'s id) and described by the rest (`aria-describedby`), so the card stays one target.

**Rationale**: The page says it manages the platform, and lists half of it. The new cards use no request. `aria-labelledby` gives the link a short name that still contains its visible title (FR-026).

## R-15: Names, sizes and fields

**Answers**: B-10, B-11, C-09, D-07, E-07, F-02, F-06, F-08.

**Decision**:

- **Rename / Archive:** `aria-label={`Rename ${category.name}`}` and `` `Archive ${category.name}` ``. The names contain the visible text.
- **Branding's Reset to default:** "Reset the logo to default", "Reset the icon to default", "Reset the share image to default", passed from `branding-form.tsx` to `ImageField` as a label. The visible text changes too: there is room, and it is clearer.
- **Replace confirmation:** "Replace the key" and "Keep the current key".
- **Certificate ID field:** `spellCheck={false}`, `autoComplete="off"`, `autoCapitalize="characters"`.
- **Placeholder:** "e.g. Science…" is not the WIG's form; the placeholder becomes "Science…".
- **Sizes:** the dialog close button (C-09) and switch hit areas (F-02, F-08) are fixed by IP T073 and T074 in the shared `ui/` files. This feature adds an admin e2e measurement.

## R-16: Tests and rules

**Answers**: G-01, and the rule for US9.

**Decision**:

- **E2e:** `packages/e2e/src/scenarios/phone-width.e2e.ts` gains an admin section: Categories with a 60-character one-word category, Reviews with a long review (chosen in the picker until US7 adds `?course=`), Certificates (looked up until US7 adds `?id=`) with a long learner name and notes, and Payments with changes, each checked with `expectNoSidewaysScroll` and `expectOnScreen` (from #892) on its buttons. The data comes from the existing helpers (`createCategory`, `createReviewedCourse`, `postReview`, `connectLocalPayments`) plus a certificate helper. Each case calls `screenshot()`.
- **Every phase that changes what users see** adds to a new `packages/e2e/src/scenarios/admin-portal.e2e.ts` with `screenshot()`, so the `UI Screenshots` PR check (constitution VIII) has a picture of each change: the home cards and not-found page (US2), titles (US3), keyboard focus after rename and archive (US4), a problem shown by its field (US6). Where a phase's only e2e work waits on IP, it still gets a case that doesn't.
- **Breadcrumbs:** the e2e breadcrumbs scenario gains an admin case: Branding's trail and `/no-such-page`. It is added only after IP T016 and T021 have merged, since it asserts their behaviour.
- **Rules:** one bullet is added to `packages/websites/CLAUDE.md` under "Layout" ([contracts/ui-rules.md](./contracts/ui-rules.md)). The other patterns this feature fixes are already covered by IP's additions.

**Rationale**: `expectNoSidewaysScroll` alone would have caught B-01, C-01 and D-01, but no admin page was in the scenario.
