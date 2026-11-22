# Research: Instructor Portal UX Fixes

Each decision names the files it was read from and the findings in [audit.md](./audit.md) it answers. The measurements come from the audit (local stack, 1440px and 375px, 2026-11-22); its screenshots are in the git-ignored `tmp/screenshots/instructor-portal-audit/`. Paths under `instructor-portal/` are relative to `packages/websites/instructor-portal/src/`.

## R-1: Why dialogs grow wider than the screen, and the fix

**Answers**: D-01, D-02 (in part), D-03, E-01.

**Decision**: Add the `grid-cols-[minmax(0,1fr)]` track to the shared `DialogContent`, in `packages/common/shadcn/src/components/ui/dialog.tsx`. Then give `min-w-0` to the flex children that hold truncating or wrapping text:

- the question card's `li`/`Card` (`content-items/quiz/question-card.tsx`, `video-questions/video-questions-editor.tsx`);
- `PostCard`'s heading and author name (`packages/common/shadcn/src/discussion/post-card.tsx`).

Text that can hold a long word also gets `break-words`:

- the rich-text editor's content (`instructor-portal/.../rich-text-editor.tsx`);
- the file name in `attach-lesson-file-dialog.tsx`.

**Rationale**: `DialogContent` is `grid` with no column template, so its single implicit column is `auto`. An `auto` track's minimum is its content's min-content width. A collapsed question's summary is `truncate` (`white-space: nowrap`), so its min-content is the whole prompt: 3,804px for a 500-character question. Expanding the card removed the overflow (1,022/1,022), which confirms the cause. A `minmax(0,1fr)` track lets the column shrink to the dialog's width, and the `truncate` then cuts the text as intended. The fix sits in the shared frame, so every dialog in the three portals gets it, the student portal's discussion dialog included.

`ui/dialog.tsx` is a shadcn file. `packages/common/shadcn/CLAUDE.md` allows changing one "only when a rule above needs it, saying so in the pull request", and the no-sideways-scroll rule needs this.

**Alternatives considered**:

- `overflow-x-hidden` on the dialog hides the symptom, clips focus rings, and leaves Save unreachable.
- Fixing each dialog's content alone would leave the next dialog with the same trap.

## R-2: Rows of controls beside a title at phone width

**Answers**: C-01, D-04, C-14, D-02 (the save bar).

**Decision**: Below `sm`, each row becomes `flex flex-wrap`:

- the title block takes `min-w-0 basis-full break-words`;
- the controls sit in their own `flex flex-wrap gap-…` group, which wraps onto the line below;
- from `sm` up, the title is `sm:basis-0 sm:flex-1` and the row looks as it does today.

The rows that change:

- the module header and the lesson row in `course/course-modules.tsx`;
- the item row in `content-items/lesson-content-items-row.tsx`;
- the archived row in `course/archived-section.tsx`.

The quiz builder's save bar (`content-items/quiz/quiz-save-bar.tsx`) gets `flex-wrap`, with its status text on its own line below `sm`.

**Rationale**: Each row is one `flex items-center` line with no wrapping, and the module `Card` is `overflow-hidden`. The title, the only shrinkable child, shrinks to 75px, or to 0px in item rows, and the controls are clipped past the card's edge. That is why `expectNoSidewaysScroll` passed while 67 controls were unreachable. Wrapping keeps every control one tap away, without a menu (spec clarification 1).

**Alternatives considered**:

- An overflow ("more") menu on phones hides Edit and Remove behind a second tap, and changes what the e2e helpers find.
- Making the card scroll sideways breaks the page-fits-the-screen rule in spirit, and hides controls just the same.

## R-3: Breadcrumbs that link nowhere

**Answers**: A-04, A-05, A-06, E-04, C-04 (the ID crumb).

**Decision**: Five changes, in `packages/common/shadcn/src/components/portal-shell.tsx` unless stated:

1. **"Home" root crumb:** the root crumb's text is "Home" (today it is "/").
2. **Unmatched crumbs as text:** `getBreadcrumbs` takes a `routeExists(href)` predicate in place of the unused `availableRoutes`. `PortalShell` builds it from the router (`router.matchRoutes(href)`, true when the deepest match is a real route, not the root or a not-found match). A crumb with no route has no `href`, and is rendered as `BreadcrumbPage` text, never as `href="#"`.
3. **Size and wrapping:** crumbs get a 24px minimum target height and `break-words`.
4. **Instructor portal labels:**
   - `segmentLabels` gains `earnings` and `settings` (`instructor-portal/components/app-layout.tsx`).
   - The `$courseId_` routes (questions, reviews, the submissions list and a submission) call `useBreadcrumbLabel` for the course's and the assignment's titles, and the review page for the student's name.
5. **Not-found page:** the `_authenticated` route gets a `notFoundComponent`, so an unknown address renders "Page not found" inside the shell.

**Rationale**:

- **Why every segment is a link:** `PortalShell` calls `getBreadcrumbs` without `availableRoutes`, so every segment counts as matched.
- **Why "unmatched" went home:** the unmatched branch sets `href: '#'`, which `<base href="/">` resolves to the portal home, the same trap as the student portal's in-page links (student spec R-2).
- **Why the existing check could never work:** `matchRoute({ to })` asks whether the *current* location matches a path, not whether a route exists, so `availableRoutes` couldn't have worked as written.
- **Why the ID crumbs:** the `$courseId_` routes are pathless siblings of `$courseId`, so the course editor's `useBreadcrumbLabel` never runs for them.

**Alternatives considered**:

- A hand-kept list of linkable paths per portal goes stale with each new route.
- Dropping crumbs for unmatched segments hides where you are; plain text keeps it.

## R-4: Titles, focus after navigation, headings and landmarks

**Answers**: A-01, A-02, A-07, A-12, A-19, A-23, B-05, C-04, C-05, C-16, E-13, E-14.

**Decision**:

- **Focus after navigation:** `PortalShell` renders the existing `RouteAnnouncer` (`containerId={MAIN_CONTENT_ID}`, `pathname`), so the instructor and admin portals move focus to the new page's `h1`, as the student portal's `site-layout.tsx` already does.
- **Titles:** each instructor route calls `usePageTitle` with the parts in [contracts/page-titles.md](./contracts/page-titles.md).
- **Main heading in every state:** each route renders its `h1` outside its loading and error branches.
  - The analytics, course editor, submission review and profile pages render a fallback `h1` ("Course analytics", "Course", "Submission", "Profile") until their data names the page.
  - The error branch keeps the page's header.
- **Main landmark:** the routes' own `<main>` becomes a `<div>`. `SidebarInset` keeps the one `<main>`.
- **Heading levels:**
  - The course editor's settings get an `h2` group heading.
  - Earnings card titles become `h2`.
  - `PostCard` takes a `headingLevel` prop (default as today; the instructor's lists pass 2 or 3 to follow their page).
- **Words while waiting:** `signin.tsx`, the `main.tsx` fallbacks and every whole-page or whole-section spinner say what they wait for, in a `role="status"` region, through a shared `LoadingState` (see [contracts/shared-components.md](./contracts/shared-components.md)).

**Rationale**:

- **Titles:** nothing in `instructor-portal/src` calls `usePageTitle`.
- **Focus after navigation:** `RouteAnnouncer` is mounted only in `student-portal/src/components/site-layout.tsx`. `PortalShell`, used by the instructor and admin portals, owns the content area and its id, so mounting it there covers both.
- **Heading and landmark:** the missing `h1`s and double `<main>` come from routes that render the heading inside the loaded branch, and wrap their content in `<main>` inside `SidebarInset`'s `<main>`.

**Alternatives considered**: Setting titles from the router's `head` option would mean a second mechanism beside the student portal's `usePageTitle`, for the same job.

## R-5: Keeping focus on a control while its action runs

**Answers**: A-13, B-12, C-07, C-08 (failed Publish), D-14, E-06, E-18, A-24.

**Decision**: Add a shared `PendingButton` in `packages/common/shadcn/src/components/pending-button.tsx`. It wraps `Button`, and while `pending`:

- it sets `aria-disabled="true"` and keeps the button focusable and in the tab order;
- it ignores clicks and form submits (`preventDefault`);
- it shows `pendingLabel` ("Saving…") in place of its children;
- it gives the same dimmed look as `disabled`.

Every instructor-portal button that today sets `disabled={isPending}` uses it. A switch or checkbox whose save is running stays enabled and ignores changes until the save settles (`aria-busy` on its row).

**Rationale**:

- **Why focus is lost:** when the focused element becomes `disabled`, browsers move focus to `<body>`. That is the single cause behind most of the focus losses after save: profile, settings forms, captions upload, grading, reply.
- **Why a shared component:** a wrapper fixes it once, gives each busy button a label that says what it is doing, and keeps the shadcn `Button` untouched.

**Alternatives considered**:

- Refocusing the button in each `onSettled` leaves a moment on `<body>`, and needs the same code in thirty places.
- A `pending` prop on `ui/button.tsx` changes a shadcn file without a rule needing it.

## R-6: Focus after a control removes or swaps itself, and on dialog close

**Answers**: A-03, A-17, B-13, B-14, C-06, C-08, D-08, D-10, E-05, E-07, E-08, E-09.

**Decision**: Three patterns, each owned by the component that makes the change, as `packages/common/shadcn/CLAUDE.md` asks.

1. **Lists:** a removed or moved item's list focuses a neighbour after the change. It uses the next item's primary control, else the previous one's, else the list's heading (made `tabIndex={-1}`). Each list keeps a ref map by item id. The lists that do this:
   - course modules, lessons and items;
   - archived rows, tags and landing items;
   - the questions' paged and reported lists;
   - quiz and video questions.
2. **Swaps:** the component that swaps views focuses the start of the new view.
   - Free preview becomes one button whose label and action change, so focus never moves.
   - The earnings period picker focuses "From", or "Month", after switching modes.
   - Announcement and grade Edit focus the first field; Cancel and Save focus Edit.
   - Return focuses the "Returned" summary.
   - Clear filters focuses the search box.
3. **Dialogs:** dialogs with no trigger (Preview as student, the discard confirmation, the thread dialog) use a shared `useReturnFocus()` hook. It records `document.activeElement` when the dialog opens, and its `onCloseAutoFocus` handler focuses that element if it is still in the document, else lets the caller's fallback run.
   - The thread dialog renders one `Dialog`, and swaps only its body between loading, error and loaded, so Radix keeps its trigger.
   - Create course passes `onCloseAutoFocus={e => e.preventDefault()}` when it closes to navigate, leaving focus to `RouteAnnouncer`.
   - The phone sidebar closes on navigation (`setOpenMobile(false)` on a pathname change in `PortalShell`), and Escape returns focus to `SidebarTrigger`.

**Rationale**: Each loss has one of three causes:

- the focused element is unmounted by its own action;
- a dialog has no trigger to return to;
- a dialog's trigger was unmounted while it was open (the thread dialog's two `Dialog`s, and Create course navigating away).

The fix belongs with whatever made the change.

**Alternatives considered**: A global "focus fallback" that catches focus landing on `<body>` and moves it somewhere would hide every such bug, and pick the wrong target.

## R-7: Keyboard reorder announcements, and a failed reorder

**Answers**: D-09, C-06.

**Decision**:

- `content-items/quiz/sortable-question-list.tsx` passes `accessibility={{ announcements, screenReaderInstructions }}` to `DndContext`, phrased as `sortable-list.tsx` already does ("Question 3, '<prompt start>', moved to position 2 of 12").
- After a drop, both lists refocus the moved item's handle by id, in a layout effect keyed on the order.
- On a failed reorder, `sortable-list.tsx` shows `apiErrorMessage(cause)` instead of `cause.message`, and refocuses the handle after the remount that restores the old order.

**Rationale**: `sortable-question-list.tsx` uses dnd-kit's defaults, which name items by their raw id (`q3`, or a UUID). `sortable-list.tsx` remounts the list (`listKey`) to roll back, which unmounts the focused handle.

## R-8: Typed work: failed saves, Cancel, dismissal, leaving the page

**Answers**: B-11, C-09, C-10, C-11, D-06.

**Decision**:

- **Failed save:** remove the `catch`-block resets in `course/course-first-lesson-prompt-form.tsx` and `course/course-price-form.tsx`.
- **Cancel:** every dialog's Cancel closes through the same handler as Escape (`onOpenChange(false)`), which resets the form. The dialogs:
  - Create course (`components/create-course-dialog.tsx`);
  - create and edit module;
  - create and edit lesson;
  - edit text, video and file;
  - create and edit assignment.
- **Escape or a click outside:** extract the quiz builder's confirmation into a shared `DiscardChangesDialog` and `useDiscardGuard(dirty)` hook. When `dirty`, the hook returns `onEscapeKeyDown` and `onInteractOutside` handlers for `DialogContent` that call `preventDefault()` and open the confirmation. "Keep editing" returns focus through `useReturnFocus`.
  - Each dialog above reports `dirty` from its form state, or, for video and file, from an upload having finished.
  - `create-assignment-dialog.tsx` wires `QuizBuilder`'s existing `onDirtyChange`, and asks before switching the kind radio away from a dirty quiz.
- **Leaving the course editor:** a shared `useUnsavedChangesGuard(dirty)` uses the router's `useBlocker` (with `enableBeforeUnload`) to ask before the instructor leaves.
  - The settings forms (catalogue, price, prompt, landing page, caption languages, announcement draft) report `dirty` to a context in `my-courses_/$courseId/route.tsx`, which calls the hook once.
  - The quiz and video-questions editors' own `beforeunload` listeners move onto this hook.

**Rationale**:

- **Why Cancel keeps text:** Cancel calls `setOpen(false)` directly, which skips the `onOpenChange` handler that runs `form.reset()`.
- **Why the guard exists in only two places:** the quiz builder and video-questions dialogs already guard with a confirmation and `beforeunload`, but the code is private to them.
- **Why shared:** making it shared keeps one wording ("Discard unsaved changes?", "Keep editing", "Discard changes") and one behaviour. The router's `useBlocker` also covers in-app links, which `beforeunload` does not.

**Alternatives considered**:

- Autosave removes the need for a guard, but it is a feature (excluded in the spec).
- Disabling outside-click close altogether makes every clean dialog harder to dismiss.

## R-9: Error sentences, Try again, and validation

**Answers**: A-10, A-11, A-14, A-15, B-06, B-07, B-08, C-04, C-06, C-12, C-20, D-05, D-07, D-11, D-12, D-13, D-15, D-17, D-18, D-22, E-14, E-15, E-16.

**Decision**:

- **Sentences:** every `error.message` shown to a person becomes `apiErrorMessage(error)`:
  - `quiz-save-bar.tsx`;
  - `video-questions-editor.tsx`;
  - `sortable-list.tsx`;
  - `packages/common/shadcn/src/components/notification-preferences.tsx`.
- **Uploads:** `instructor-portal/lib/put-file-with-progress.ts` rejects with a `TypeError` (message unchanged, `cause` set) on `xhr.onerror`, so `apiErrorMessage` reads it as a network failure. The dialogs' headers say "Couldn't upload the …" for upload failures.
- **Try again:**
  - Every failed load passes `onRetry` to `ErrorAlert`, wired to the query's `refetch`. The hand-built "Retry" buttons beside alerts are removed (home, dashboard, analytics, quiz panel, the four earnings cards, profile).
  - Where one section depends on several queries (reviews: summary and list), one `ErrorAlert` shows, and its retry refetches all of them.
  - The hand-rolled error blocks in `paged-list.tsx`, `by-lesson-view.tsx`, `submissions-table.tsx` and `reviews-screen.tsx` become `ErrorAlert`.
  - A "not found" error keeps its own message, with a link back instead of Try again.
- **Validation:**
  - Forms keep Save enabled (or `PendingButton` while saving).
  - On submit with problems, focus moves to the first invalid field. Each problem has an `id`, referenced from its field's `aria-describedby`, with `aria-invalid` set.
  - The forms: Create course, profile, edit text, video and file, assignments, the grading form's Points, the quiz builder (`showProblemsFirst` focuses the first problem's field).
- **Silent states:**
  - **Wrong file type:** `attach-lesson-video-dialog.tsx` handles the dropzone's rejections as the file dialog does (`rejectionMessage`).
  - **Caption removal failure:** the error renders inside the open `AlertDialogContent`.
  - **Video processing:** the item row shows a "Processing…" or "Processing failed" badge from `item.status`, and the tooltip on the disabled Questions button goes.
  - **Draft course announcements:** the section says "Publish the course to post announcements." instead of the form.
  - **Disabled "Delete permanently":** its reason shows as text beside it.
  - **Checklist profile line and category select:** they show an inline error with Try again when their query fails.
  - **Video questions player:** "Loading the video…" while its URL loads; `ErrorAlert` with retry when it fails. "Add an end question" stays available without the player.
- **My Courses empty states:** "You don't teach any courses yet" with Create course when the unfiltered list is empty. "No courses found" with Clear filters when filters hide everything.

**Rationale**:

- `apiErrorMessage` (`packages/common/web-utils/src/api-errors.ts`) already turns `TypeError`s and the browser phrases into "Couldn't reach Discava…". These call sites bypass it, and the upload helper hides the `TypeError` behind a plain `Error`.
- `ErrorAlert` already has `onRetry` and `retryLabel` (from the student-portal feature). The instructor portal predates it.

## R-10: Views in the address

**Answers**: A-21, B-09, E-10.

**Decision**: Add `validateSearch` (zod, as the student portal's search routes do) to three routes.

| Route | Search params | Default |
|-------|---------------|---------|
| `my-courses/route.tsx` | `status`: `all` \| `published` \| `draft` \| `archived`; `q`: string | `all`, empty |
| `my-courses_/$courseId_/questions/route.tsx` | `tab`: `unanswered` \| `reported` \| `by-lesson`; `lesson`: lesson id | `unanswered`, none |
| `earnings/route.tsx` | `month` (`YYYY-MM`), or `from` and `to` (`YYYY-MM-DD`) | the current month |

The controls read from `Route.useSearch()` and write with `navigate({ search, replace })`:

- typing in a search box uses `replace: true`, debounced as the filter is today;
- choosing a tab, filter or period pushes a history entry.

Defaults are left out of the address. An invalid value falls back to the default.

**Rationale**:

- These are client-side views over data already loaded, or inputs the page already sends: the earnings period becomes the same `from`/`to` the picker sends today.
- Reading them from the address changes no request (FR-031).

## R-11: The course editor's order and section links

**Answers**: C-03, C-02.

**Decision**:

- **Order:** in `my-courses_/$courseId/route.tsx`, render "Course content" directly after the header card, then the settings sections, announcements and the archived section.
- **Section links:** a new route-private `-components/section-links.tsx` renders a `nav` labelled "Course sections" under the header.
  - It holds one router `Link to="." hash="<id>"` per section that is on the page.
  - It sits in an `overflow-x-auto` row.
- **Section headings:** each section's heading gets an `id` and `tabIndex={-1}`, and a hash change focuses it (honouring `prefers-reduced-motion` for the scroll).
- **Landing-page checklist:** its "Add it" links switch from `<a href="#…">` to the same `Link` with `hash`, named "Add it: <item>". The profile line becomes `Link to="/profile"`.

**Rationale**:

- `<base href="/">` makes `href="#id"` go home, as found in the student portal (student spec R-2). The router's `Link` with `hash` keeps the path and scrolls.
- Moving the most-used section first and adding links shortens the way to every section, without hiding any (spec clarification 2).

**Alternatives considered**: Tabs, rejected by the maintainer in clarification.

## R-12: Long content on the remaining pages

**Answers**: A-09, A-20, B-01, B-02, B-03, B-04, B-10, B-18, C-13, C-18, E-02, E-03.

**Decision**:

- **Analytics:** grid tracks become `minmax(0,1fr)`, or the children get `min-w-0` (`dashboard_/$courseId/route.tsx`).
- **Lesson drop-off:**
  - titles wrap (`break-words`) instead of truncating;
  - the started and completed counts are always visible;
  - the `li`s lose `tabIndex`.
- **Score chart:** below 480px it labels every other band (`interval` from the container's width via recharts' `ResponsiveContainer` render prop), so labels never overlap.
- **Most-missed questions table:** its question cells get `break-words [overflow-wrap:anywhere]`.
- **Course cards** (home, dashboard, My Courses): the title gets `min-w-0 break-words`, the description `line-clamp-3 break-words`, the badge `shrink-0`.
- **Long words:**
  - announcement titles, review and response text, reviewer names, and the submission page's `h1` get `break-words`;
  - the breadcrumb wraps (R-3).
- **Submission review:**
  - its grid uses `minmax(0,1fr)` columns;
  - `pdf-preview.tsx` sizes the page to its container, `min(560, container width)`, read with a `ResizeObserver` in an effect, not during render.
- **Earnings tables:** cells get horizontal padding, dates and amounts `whitespace-nowrap`, and the payouts table an `overflow-x-auto` wrapper.
- **Maths popover:** `w-[min(24rem,calc(100vw-2rem))]`.

**Rationale**: Each is the same root cause as R-1. A child that holds text can't shrink below its content, or a long word can't break.

## R-13: Target sizes and names

**Answers**: A-16, A-18, B-17, B-20, B-21, C-15, C-19, D-19, D-20, D-21, D-23, E-17, E-19.

**Decision**:

- **Hit areas** (shared shadcn files, under the rule-needs-it clause):
  - `ui/checkbox.tsx`, `ui/radio-group.tsx` and `ui/switch.tsx` gain an invisible 24px hit area (`relative after:absolute after:-inset-1 after:content-['']` for 16px controls; `after:-inset-y-0.5` for the 20px switch), so their look doesn't change.
  - The dialog close button becomes `size-6` with the 16px icon.
- **One target with the label:**
  - `notification-preferences.tsx` names each switch with a `<Label htmlFor>`;
  - the quiz settings and certificate criteria put each checkbox and its text in one `<label>`.
- **Short links:** "Show orders", the tag Remove buttons and the editor's Reviews and Questions links get a 24px minimum height.
- **Names:**
  - "Open course" links are `aria-label="Open course: <title>"`.
  - Module buttons are named by title ("Edit module <title>").
  - "Questions (3) for <title>".
  - "Move up, question 2".
- **Dashboard cards:** each card's link is its title, stretched over the card (`after:absolute after:inset-0`).
- **Dialogs:**
  - The four dialogs' intros become `DialogDescription`.
  - Captions opens on its Language select.
  - The drop zone becomes `role="button"` with a name.
  - Upload progress sits in `role="status"`.
- **Grading Feedback:** the label is tied to its editor through `aria-labelledby`.

**Rationale**: The hit-area approach meets the 24px rule without restyling every form in three portals. The visual size is brand styling, which is out of scope.

## R-14: Announcements that say too much or too little

**Answers**: C-17, D-14, D-16, E-06, E-07, E-08, E-20.

**Decision**: Add a shared `StatusMessage` (`packages/common/shadcn/src/components/status-message.tsx`). It is an always-mounted `role="status"` element whose text the caller sets, and clears after a few seconds. These use it:

- the settings forms' "Saved";
- "Posted" for announcements;
- "Reply posted";
- "Grade returned";
- "<Language> captions added";
- "Report dismissed".

Character counters drop `aria-live` and are tied to their textarea with `aria-describedby`. The video-questions clock drops `role="status"`.

**Rationale**:

- **Why "Saved" may not be heard:** a `role="status"` element inserted together with its text is often not announced; the region must exist before its content changes.
- **Why the counter and clock speak too much:** their live regions speak on every keystroke or second.

## R-15: Tests

**Decision**:

- **Component tests** sit beside each changed file in the instructor portal, and in `common-shadcn` for each shared piece. They cover:
  - focus after each action;
  - names;
  - Cancel and discard;
  - `aria-describedby`;
  - views from the address.
- **E2e:** `packages/e2e/src/scenarios/phone-width.e2e.ts` gains instructor cases:
  - the course editor (every control on screen);
  - the quiz-builder and video-questions dialogs (fit, Save on screen);
  - analytics, the submission review, reviews and a thread.

  Two helpers go in `helpers/viewport.ts`:
  - `expectDialogFits(dialog)`;
  - `expectOnScreen(locator)` (every match's box within the viewport).
- **Existing scenarios** extend for breadcrumbs (`breadcrumbs.e2e.ts`), unsaved work (`quiz.e2e.ts`) and views in the address (`instructor-home.e2e.ts` or a new `instructor-views.e2e.ts`).

**Rationale**: The phone-width scenario and `expectNoSidewaysScroll` exist. That check passed while controls were clipped inside cards (C-01), so an on-screen check is needed for controls as well.
