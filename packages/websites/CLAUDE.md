# Portals: UI rules

These apply to every screen in the three portals and to the shared components in `packages/common/shadcn`. They are checks: before opening a pull request that changes what a user sees, each one that applies must be true. The root `CLAUDE.md` has the code conventions (text-only buttons, file layout, where screenshots go); this file does not repeat them.

For anything not covered here, follow the [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines). To audit a screen against all of them, run the `web-design-guidelines` skill on its files.

## Check every changed screen this way

1. At **375px** and at **1440px** wide.
2. In each state it has: loading, empty, error, and long content (a 90-character title, a 500-character description, a 70-character word with no spaces).
3. With the keyboard alone: Tab to every control, use it, and see where focus is afterwards.
4. Save screenshots of what you checked as the root `CLAUDE.md` says, and add the changed screen to its e2e scenario with `screenshot()`.

## Layout

- The page never scrolls sideways at 375px. `expectNoSidewaysScroll` in `packages/e2e/src/helpers/viewport.ts` checks it; add a new page to `phone-width.e2e.ts`.
- A grid or flex child that holds text which truncates (`truncate`, `line-clamp-*`) has `min-w-0`, and a grid that must keep its proportions uses `minmax(0, …)` tracks. Without them a long title widens the column.
- On a phone the page's main content comes first. A side panel (an outline, filters) goes in `ResponsivePanel`, which is closed below `lg`.
- A row of tabs or chips that can outgrow the screen scrolls inside itself (`overflow-x-auto`), never the page.
- The top bar fits at 375px for every kind of signed-in user. Links that do not fit go in `UserMenu`'s `items`.
- An icon next to text that can wrap has `shrink-0`.
- User-written text has a limit on how much shows: titles truncate or wrap with `break-words`, descriptions in cards use `line-clamp-*`.

## Links and navigation

- A link to a part of the same page is a router `Link` with `hash`, never `<a href="#id">`: the portals set `<base href="/">`, so a bare fragment goes to the home page.
- A link works when opened in a new tab. Navigation is a `Link`, never an `onClick` on a button or a `div`.
- No link points at the element it sits in, or at a page that does not exist.
- Every route calls `usePageTitle` with its own name first, then its parent's ("Lesson · Course"). The hook adds the application name.
- Every page has exactly one `h1`, and heading levels are not skipped. `RouteAnnouncer` focuses the `h1` after navigation, so a page without one is silent to a screen reader.
- State a person would want to share or come back to (filters, sort, search text, the open tab) lives in the address, and an input that mirrors the address is kept in step with it, Back included.

## Keyboard and screen readers

- After any action, focus is on something sensible: the control that was used if it is still there, otherwise the start of what replaced it. Focus is never left on `<body>`. When a component swaps one view for another, the component that owns the swap moves focus (see `QuizCard`).
- A control does not disappear while the data behind it reloads. Queries that redraw controls from their answer use `placeholderData: keepPreviousData` and mark the region `aria-busy`.
- A result the user is waiting for (a score, a saved state, a count) is in a `role="status"` region; an error is `role="alert"` (`ErrorAlert type="error"` does this).
- Every control a user must use is at least 24px by 24px. A checkbox or radio and its label are one target with no gap between them.
- A link's or button's accessible name contains its visible text. Use `aria-label` to add context ("Continue: Linear Algebra"), not to replace the words.
- Motion started by script honours `prefers-reduced-motion`.

## Errors and waiting

- Show a failed request with `apiErrorMessage(error)`, never `error.message`. It turns network and server faults into sentences with a next step and passes through messages the API wrote for people.
- A failed load offers "Try again" through `ErrorAlert`'s `onRetry`, wired to the query's `refetch`. A failed action leaves its button usable.
- A wait says what it is waiting for: "Loading…", "Saving…", "Signing you in…", with a real ellipsis. A spinner alone is not enough when it is the whole page.
- An action that cannot be undone and uses something up (a quiz attempt, a payment) says so beside its button.

## Where code goes

- A component, hook or helper a second portal could use goes in `packages/common/shadcn` (UI, hooks) or `packages/common/web-utils` (no UI). Fix a shared component there, not by overriding it in one portal.
- Before writing a component, look in `packages/common/shadcn/src/components/` and its `ui/` folder: `ErrorAlert`, `ResponsivePanel`, `PortalShell`, `UserMenu`, `QuizCard` and the shadcn primitives cover most needs.
- A shared component's `size` or `variant` prop wins over a class with the same property. For a one-off size, leave the prop off and use the class.
