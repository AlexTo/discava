# Portals: UI rules

These apply to every screen in the three portals and to the shared components in `packages/common/shadcn`. They are checks: before opening a pull request that changes what a user sees, each one that applies must be true. The root `CLAUDE.md` has the code conventions (text-only buttons, file layout, where screenshots go); this file does not repeat them.

For anything not covered here, follow the [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines). To audit a screen against all of them, run the `web-design-guidelines` skill on its files.

## Check every changed screen this way

1. At **375px** and at **1440px** wide.
2. In each state it has: loading, empty, error, and long content (a 90-character title, a 500-character description, a 70-character word with no spaces).
3. With the keyboard alone: Tab to every control, use it, and see where focus is afterwards.
4. Save screenshots of what you checked as the root `CLAUDE.md` says, and add the changed screen to its e2e scenario with `screenshot()`. A page with rows of controls or a dialog also gets `expectOnScreen` / `expectDialogFits` in `phone-width.e2e.ts`: `expectNoSidewaysScroll` passes when a card clips its content.

## Layout

- The page never scrolls sideways at 375px. `expectNoSidewaysScroll` in `packages/e2e/src/helpers/viewport.ts` checks it; add a new page to `phone-width.e2e.ts`.
- A grid or flex child that holds text which truncates (`truncate`, `line-clamp-*`) has `min-w-0`, and a grid that must keep its proportions uses `minmax(0, …)` tracks. Without them a long title widens the column.
- On a phone the page's main content comes first. A side panel (an outline, filters) goes in `ResponsivePanel`, which is closed below `lg`.
- A row of tabs or chips that can outgrow the screen scrolls inside itself (`overflow-x-auto`), never the page.
- The top bar fits at 375px for every kind of signed-in user. Links that do not fit go in `UserMenu`'s `items`.
- An icon next to text that can wrap has `shrink-0`.
- User-written text has a limit on how much shows: titles truncate or wrap with `break-words`, descriptions in cards use `line-clamp-*`.
- A row that holds a title and controls wraps below `sm`: the title takes the full width (`min-w-0 basis-full break-words`) and the controls wrap onto the line below. A row inside an `overflow-hidden` card never relies on shrinking its title to fit.
- A dialog's content never makes it wider than the screen: `DialogContent` has a `minmax(0,1fr)` column, and nothing inside overrides it. A dialog's footer of actions wraps, so its primary action is on screen at 375px.
- Information is never only on hover: counts, reasons and full titles are visible text, or reachable by focus on a control that does something.

## Links and navigation

- A link to a part of the same page is a router `Link` with `hash`, never `<a href="#id">`: the portals set `<base href="/">`, so a bare fragment goes to the home page.
- A link works when opened in a new tab. Navigation is a `Link`, never an `onClick` on a button or a `div`.
- No link points at the element it sits in, or at a page that does not exist.
- Every route calls `usePageTitle` with its own name first, then its parent's ("Lesson · Course"). The hook adds the application name.
- Every page has exactly one `h1`, and heading levels are not skipped. `RouteAnnouncer` focuses the `h1` after navigation, so a page without one is silent to a screen reader.
- State a person would want to share or come back to (filters, sort, search text, the open tab) lives in the address, and an input that mirrors the address is kept in step with it, Back included.
- A route whose path has an id in it labels that crumb with `useBreadcrumbLabel` (the course's, assignment's or student's name). A crumb is never an id.
- The `h1` is rendered outside the loading and error branches, with a fallback name ("Course") until the data names the page. A route never renders its own `<main>`; the layout has it.

## Keyboard and screen readers

- After any action, focus is on something sensible: the control that was used if it is still there, otherwise the start of what replaced it. Focus is never left on `<body>`. When a component swaps one view for another, the component that owns the swap moves focus (see `QuizCard`).
- A control does not disappear while the data behind it reloads. Queries that redraw controls from their answer use `placeholderData: keepPreviousData` and mark the region `aria-busy`.
- A result the user is waiting for (a score, a saved state, a count) is in a `role="status"` region; an error is `role="alert"` (`ErrorAlert type="error"` does this).
- Every control a user must use is at least 24px by 24px. A checkbox or radio and its label are one target with no gap between them.
- A link's or button's accessible name contains its visible text. Use `aria-label` to add context ("Continue: Linear Algebra"), not to replace the words.
- Motion started by script honours `prefers-reduced-motion`.
- A button whose action is running is a `PendingButton`, never `disabled={isPending}`: disabling the focused button sends focus to `<body>`.
- An action that removes its own control (delete, archive, restore, dismiss, the last "Load more") focuses the neighbouring item, or the list's heading when none is left. A dialog with no trigger element uses `useReturnFocus`.
- A keyboard reorder announces the item by title and its new position ("Question 3 moved to position 2 of 12"), never an id, and keeps focus on the moved item's handle.
- `StatusMessage` is mounted before it has anything to say. A character counter or a clock is not a live region; tie a counter to its field with `aria-describedby`.

## Errors and waiting

- Show a failed request with `apiErrorMessage(error)`, never `error.message`. It turns network and server faults into sentences with a next step and passes through messages the API wrote for people.
- A failed load offers "Try again" through `ErrorAlert`'s `onRetry`, wired to the query's `refetch`. A failed action leaves its button usable.
- A wait says what it is waiting for: "Loading…", "Saving…", "Signing you in…", with a real ellipsis. A spinner alone is not enough when it is the whole page.
- An action that cannot be undone and uses something up (a quiz attempt, a payment) says so beside its button.
- A failed save keeps everything that was typed. Never reset a field in a `catch`.
- Cancel and Escape close a dialog through the same handler, which resets its form. A dialog holding typed or uploaded work uses `useDiscardGuard`; a page with its own Save buttons uses `useUnsavedChangesGuard`.
- Save is never disabled because a form is incomplete. On submit, focus the first invalid field; each error has an `id` its field references with `aria-describedby`, and the field has `aria-invalid`.
- A control that is unavailable says why in visible text beside it, never only in a `title` tooltip. A section that doesn't apply yet says so instead of showing a form the server will refuse.
- An empty list says which kind of empty it is: nothing yet (with the action that adds the first one), or a filter that hides everything (with a way to clear it).
- An error inside an open confirmation is shown in that confirmation, not in the dialog behind it.

## Where code goes

- A component, hook or helper a second portal could use goes in `packages/common/shadcn` (UI, hooks) or `packages/common/web-utils` (no UI). Fix a shared component there, not by overriding it in one portal.
- Before writing a component, look in `packages/common/shadcn/src/components/` and its `ui/` folder: `ErrorAlert`, `ResponsivePanel`, `PortalShell`, `UserMenu`, `QuizCard` and the shadcn primitives cover most needs.
- A shared component's `size` or `variant` prop wins over a class with the same property. For a one-off size, leave the prop off and use the class.
