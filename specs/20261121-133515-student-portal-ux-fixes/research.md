# Research: Student Portal UX Fixes

Each decision names the files it was read from. Measurements are from the two audits (local stack, 1440px and 375px, 2026-11-21); their screenshots are in the git-ignored `tmp/screenshots/ux-audit/`.

## R-1: Why the lesson page is too wide, and the fix

**Decision**: In `CoursePlayerLayout`, give the grid `lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]` and the outline `aside` `min-w-0`. Do the same wherever a grid or flex child holds `truncate` text: a child that should shrink gets `min-w-0`.

**Rationale**: A `1fr` track's minimum is its content's minimum width. The outline's titles are `truncate`, which is `white-space: nowrap`, so the minimum is the longest title: 611px for a 64-character module title. Below `lg` the grid is one implicit `auto` column with the same minimum, which is the 635px page at 375px. Injecting `min-width: 0` on the `aside` in the running page gave 352px/704px at 1440px and removed the body overflow at 375px.

**Alternatives considered**: `overflow-x-hidden` on `main` hides the symptom and clips focus rings. Wrapping titles instead of truncating changes the outline's design and is not needed.

## R-2: In-page links with `<base href="/">`

**Decision**: Replace `<a href="#id">` with the router's `<Link to="." hash="id">` (current route, same params and search), and keep `scroll-mt-*` on the targets. For the lesson's step links, which also scroll in script, keep the click handler but build the `href` the same way and pass `behavior` from `prefers-reduced-motion`.

**Rationale**: `index.html` sets `<base href="/">`, so a bare fragment resolves to `/#id`. The router's `Link` produces the full path with the fragment, handles the click itself, and scrolls to the element whose id matches. It also gives the right address in a new tab.

**Alternatives considered**: Removing `<base>` would fix fragments but changes how relative asset and route URLs resolve in all three portals (they share the template), for a wider blast radius than five links. Building `href` from `window.location.pathname` works but duplicates what `Link` does and misses the router's scroll handling.

## R-3: The top bar at phone width

**Decision**: Below `sm` (640px), `site-layout.tsx` hides the "Instructor" and "My Learning" buttons and passes them to `UserMenu` as `items`, first in the list. The search form keeps `flex-1 min-w-0`. The suggestion list is positioned against the viewport below `sm` (`fixed inset-x-4` under the bar) instead of against the 180px form, and each suggestion's title may wrap to two lines (`line-clamp-2`) at every width.

**Rationale**: At 375px the bar holds a 40px logo, the search form, two text buttons (about 95px and 115px), the bell and the avatar, with `shrink-0` on the right-hand group, which leaves the form 54px. Without the two buttons the form gets about 180px signed in, the same as signed out. `UserMenu` already accepts `items`, so the shared component is unchanged. The list is `absolute left-0 right-0` inside the form, so it is as narrow as the form; anchoring it to the viewport on a phone gives 343px.

**Alternatives considered**: A search icon that expands into a full-width field is the common pattern but adds a state and a control, and hides the field people came for. A second row under the bar costs 48px on every page.

## R-4: Keeping the filter panel while results reload

**Decision**: Add `placeholderData: keepPreviousData` to the `course.publicSearch` infinite query in `CatalogueResults`; while `isPlaceholderData` is true, set `aria-busy` on the results region and dim it. The panel then renders from the previous answer's `facets`. Wrap the panel in `ResponsivePanel` (R-11) so it is closed on a phone.

**Rationale**: A filter change is a new query key with no data, so `facets` is undefined and the panel unmounts, taking focus with it (43 of 43 samples over 0.9s in the audit). `keepPreviousData` changes what is shown, not what is requested. The checkbox that was toggled keeps its identity because its `id` is `filter-<group>-<value>` and the facet list for an unchanged group does not reorder.

**Alternatives considered**: Rendering the panel from the filters in the address needs the counts, which only the response has. Restoring focus by id after the reload works but leaves the layout jump.

## R-5: Focus and announcements in the quiz card

**Decision**: `QuizCard` keeps a ref to its content wrapper and, in an effect keyed on the phase (name and question index), focuses the phase's first heading-like element, which gets `tabIndex={-1}`: the "Question N of M" line, the review's summary line, the result's score line, the overview's summary line. The first render does not move focus. The score line is inside a `role="status"` region so it is announced; the submit error keeps the `Alert`'s `role="alert"`.

`ReviewPhase` receives `attemptNumber` and `attemptsAllowed` (both already known to `QuizCard`) and shows "This uses attempt N of M" when `attemptsAllowed` is not null; its button reads "Submit answers".

The navigator's buttons become `size-6` (24px) with the number as text, keeping `aria-current="step"` and the "Question N, answered" accessible name. `quiz-result-questions.tsx` gives the tick `shrink-0` and the row `items-start`.

**Rationale**: The phases are different components, so React removes the focused button when the phase changes. Only `QuizCard` knows a phase changed. Focusing a non-interactive line (not the first radio) lets a screen reader read the question before the options and does not select anything.

**Alternatives considered**: Keeping one persistent button row across phases would avoid the loss for some transitions but not for the overview or the result. `autoFocus` on each phase's first control fires on first render too, and would pull the page to the quiz when a lesson loads.

## R-6: Error sentences

**Decision**: In `common-web-utils/src/api-errors.ts`:

- a request that never got an answer (the error has no `data.code` and its cause, or itself, is a `TypeError`, or its message is one of the three browser phrases) gives "Couldn't reach Discava. Check your connection and try again.";
- `INTERNAL_SERVER_ERROR` always gives "Something went wrong on our side. Try again in a moment.", whatever its message, and `MESSAGES` gains that code;
- everything else is unchanged: a written message is shown as written.

The call sites that read `error.message` directly switch to the helper: `enrolErrorMessage` (its `NOT_FOUND` and `PRECONDITION_FAILED` branches stay), `QuizItem`'s load error and its `onSubmit` `default` branch, and `Unavailable` in `course-player.tsx`. `ErrorAlert` gains `onRetry` and `retryLabel` (default "Try again"), and the lesson, quiz, signed-in home and course page use it with the query's `refetch`. The three pages that already hand-build the same button (`catalogue-results.tsx`, `category/$slug.tsx`, `instructors/$handle.tsx`) switch to the prop.

**Rationale**: The helper's rule "a message that isn't the code was written for people" is wrong for exactly two sources, and both are identifiable without guessing. An internal error's message is never for people: a procedure that wants to tell the user something throws a typed error with another code.

**Alternatives considered**: An allow-list of codes whose messages are trusted is safer in principle but would hide the many hand-written `BAD_REQUEST` and `PRECONDITION_FAILED` messages the product relies on unless every one is audited. A global error boundary does not help: these are query states, not thrown renders.

## R-7: Page titles and focus on navigation

**Decision**: `common-web-utils/src/page-title.ts` exports `pageTitle(...parts)`, which drops empty parts, appends the application name and joins with " · ". `common-shadcn/src/hooks/use-page-title.ts` exports `usePageTitle(...parts)`, which sets `document.title` in an effect and does not restore the old one on cleanup (the next page sets its own). Each route component calls it with the parts in [contracts/page-titles.md](./contracts/page-titles.md).

`common-shadcn/src/components/route-announcer.tsx` exports `RouteAnnouncer`, mounted once in `SiteLayout`. On a change of pathname (not of search or hash, and not on first load) it focuses the first `h1` inside the main content area once one exists, giving it `tabIndex={-1}`. It waits for the heading with a `MutationObserver` that it disconnects on the next navigation or after 5 seconds.

**Rationale**: Focusing the heading both moves the keyboard and makes a screen reader read the page's name, with no separate live region to keep in step. Pathname-only keeps filter and tab changes, which are search and hash changes, from stealing focus (US4, US2). `RouteAnnouncer` does not touch the title. It sits in `SiteLayout`, the parent of every route, and React runs passive effects child-first: a reset there would run after the new route's `usePageTitle` and overwrite it, permanently for a page with a fixed title or a cached query (found in review of the spec PR). What stops a page keeping the last one's title while it loads (US7 scenario 3) is that every route calls `usePageTitle` from its first render, with the fallback parts the contract lists for the loading and error states.

**Alternatives considered**: Resetting the title before the new route commits (a router `onBeforeLoad` or `onResolved` subscription, or a layout effect) would also work, but it is a second writer of the title that every route already sets; one writer per page is simpler to reason about. The router's `head()` route option manages titles, but it needs `HeadContent` rendered in the document head and loaders to know the names; these portals fetch in components, so the name is only known there. A live region that announces the title is the other common pattern; it does not move focus, so a keyboard user still starts from the previous page's position.

## R-8: Instructor profile

**Decision**: Remove `size="lg"` from the profile's `Avatar` so `size-28` applies; give `AvatarFallback` `text-3xl` as now. When `profile.courses` is empty, show "No published courses yet." under the heading. Replace the `document.title` effect with `usePageTitle(profile?.displayName)`.

**Rationale**: `Avatar` applies `data-[size=lg]:size-10`, which outranks a plain class. The component's sizes are for lists and menus; a profile picture is a one-off size, and a class is the right tool.

**Alternatives considered**: Adding an `xl` size to the shared `Avatar` for one use.

## R-9: Phone-width end-to-end checks

**Decision**: A new scenario file, `packages/e2e/src/scenarios/phone-width.e2e.ts`, with `test.use({ viewport: { width: 375, height: 812 } })`. A helper `expectNoSidewaysScroll(page)` in `helpers/viewport.ts` asserts `document.documentElement.scrollWidth <= clientWidth`. The scenario makes its own instructor-student, a course with 60-character titles and catalogue fields, and visits each audited page. Desktop checks (column ratio, section links) extend `learn.e2e.ts` and `public-landing-page.e2e.ts`; keyboard checks extend `quiz.e2e.ts`; filter focus extends `search.e2e.ts`.

**Rationale**: `playwright.config.ts` has one "Desktop Chrome" project. `test.use` scopes a viewport to a file without doubling the suite's run time, which a second project would.

**Alternatives considered**: A mobile project that runs every scenario: most scenarios assert flows, not layout, and CI time would double.

## R-10: Where the UI rules live

**Decision**: `packages/websites/CLAUDE.md` holds the rules (text in [contracts/ui-rules.md](./contracts/ui-rules.md)). `packages/common/shadcn/CLAUDE.md` is a few lines: what belongs in the package, and "follow `packages/websites/CLAUDE.md`". The root `CLAUDE.md` names the new file in its Architecture list and keeps its own UI conventions (text-only buttons, file layout) where they are; `CONTRIBUTING.md` gets one line under code style. The rules link to the Web Interface Guidelines and to the `web-design-guidelines` skill for a full audit.

**Rationale**: Claude Code loads a nested `CLAUDE.md` when it works in that directory, which is how every other package's detail is scoped here, so the rules cost nothing in sessions that touch no UI and need no one to remember them in sessions that do. The skill fetches the public guidelines on demand; it is an audit tool, not standing instructions, and it knows nothing this project decided (the two widths, the shared components to reuse, where screenshots go).

**Alternatives considered**: Putting the rules in the root `CLAUDE.md` loads them into every backend session. A docs-site page is read by people but not loaded by agents. A constitution principle is for rules a plan must not break; "no sideways scroll" is a review check, and the constitution already says UI changes take screenshots. Copying the whole of the Web Interface Guidelines into the repo would go stale.

## R-11: One component for "closed on a phone, open on a desktop"

**Decision**: `common-shadcn/src/components/responsive-panel.tsx`: `ResponsivePanel({ label, summary, children })`. Below `lg` it renders a `Collapsible`, closed, whose trigger is a full-width outline button reading `label` with `summary` beside it (the current lesson's title; "2 active"); at `lg` and above the trigger is hidden and the content is always shown. The switch is CSS (`lg:hidden` on the trigger, `lg:!block` on the content), so there is no width measurement and no flash on load.

**Rationale**: The outline and the filter panel need the same thing, and the instructor portal's lists will too. CSS-only switching avoids `useIsMobile`'s first-render mismatch and any layout read.

**Alternatives considered**: A `Sheet` (drawer) for filters is common on phones, but it covers the results the filter is changing, and FR-014 wants the changed control to keep focus while results update in view. Two separate implementations in the portal would break FR-029 the next time a portal needs one.
