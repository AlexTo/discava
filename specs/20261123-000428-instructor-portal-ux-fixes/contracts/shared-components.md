# Contract: shared pieces

What each shared piece promises its callers. Tests in `packages/common/shadcn` assert these, and a change here runs the tests of every portal that uses the piece (`packages/common/shadcn/CLAUDE.md`).

## `PendingButton` (`@discava/common-shadcn/components/pending-button`), new

```ts
interface PendingButtonProps extends React.ComponentProps<typeof Button> {
  /** The action is running. */
  pending: boolean;
  /** Shown while pending, e.g. "Saving…", "Returning…". Ends with "…". */
  pendingLabel: string;
}
```

- While `pending`, the button:
  - sets `aria-disabled="true"`;
  - keeps its place in the tab order and keeps focus if it has it;
  - ignores clicks and, as a submit button, its form's submission;
  - shows `pendingLabel`.
- When `pending` ends, focus is still on the button if it was there.
- `disabled` keeps its usual meaning, for an action that is not available. It is never set just because the action is running.

## `useReturnFocus` (`@discava/common-shadcn/hooks/use-return-focus`), new

```ts
function useReturnFocus(open: boolean): {
  /** Pass to DialogContent / AlertDialogContent / SheetContent. */
  onCloseAutoFocus: (event: Event) => void;
};
```

- **When it records:** on `open` becoming true, it records `document.activeElement`.
- **On close:** if the recorded element is still in the document and focusable, it focuses it and prevents Radix's default. Otherwise it lets the default run, so a caller can chain its own fallback.
- **When to use it:** for dialogs opened from state with no trigger element (Preview as student, the discard confirmation), and for dialogs whose trigger can disappear while they are open.

## `DiscardChangesDialog` and `useDiscardGuard` (`@discava/common-shadcn/components/discard-changes-dialog`, `.../hooks/use-discard-guard`), new

Both hooks in this file that return JSX (`useDiscardGuard`, `useUnsavedChangesGuard`) live in `.tsx` files.

```ts
function useDiscardGuard(options: {
  dirty: boolean;
  /** Close the dialog and reset its form. */
  discard: () => void;
}): {
  /** Spread onto DialogContent. */
  contentProps: {
    onEscapeKeyDown: (e: KeyboardEvent) => void;
    onInteractOutside: (e: Event) => void;
  };
  /** Use for the Close (X) button and any other non-Cancel close. */
  requestClose: () => void;
  /** Render once inside the dialog. */
  confirmation: React.ReactNode;
};
```

- **Clean dialog:** with `dirty` false, Escape, outside click and `requestClose` call `discard` at once.
- **Dirty dialog:** with `dirty` true, they open the confirmation instead.
  - Its title is "Discard unsaved changes?", and its actions are **Keep editing** (focused first) and **Discard changes**.
  - **Keep editing** closes the confirmation and returns focus to where it was in the dialog (through `useReturnFocus`).
  - **Discard changes** calls `discard`.
- **Cancel** is not routed through the guard; it calls `discard` directly (spec clarification 3).
- **Existing callers:** the quiz builder's and video-questions dialog's existing confirmations become this component, with the same wording.

## `useUnsavedChangesGuard` (`@discava/common-shadcn/hooks/use-unsaved-changes-guard`), new

```ts
function useUnsavedChangesGuard(dirty: boolean): {
  /** The "Leave without saving?" dialog. Render once in the page. */
  confirmation: React.ReactNode;
};
```

- **In-app links:** while `dirty`, following a link inside the portal opens the `confirmation`, "Leave without saving?", with **Stay** (focused first) and **Leave**. **Stay** cancels the navigation, and **Leave** lets it proceed.
- **Closing or reloading:** the browser's own leave prompt is enabled for closing or reloading the tab.
- **Redirects:** a redirect the portal makes itself (session expired, sign-in) is not blocked.
- **Implementation note:** this uses the router's blocker. The package already depends on `@tanstack/react-router` for `PortalShell`, and imports no portal's route tree.

## `StatusMessage` (`@discava/common-shadcn/components/status-message`), new

```ts
interface StatusMessageProps {
  /** The sentence to announce; null or '' shows nothing. */
  message: string | null;
  /** Visible (default) or screen-reader only. */
  visuallyHidden?: boolean;
  /** Clear after this many ms (default 5000). */
  clearAfter?: number;
}
```

- **Always mounted:** the `role="status"` element is mounted from the first render, so the first message is announced.
- **Repeats:** setting the same message again announces it again.
- **Clearing:** clearing makes no announcement.

## `LoadingState` (`@discava/common-shadcn/components/loading-state`), new

```ts
interface LoadingStateProps {
  /** What is loading, as a sentence with an ellipsis: "Loading the course…". */
  label: string;
  /** A whole page (centred, larger) or a section (inline). Default section. */
  size?: 'page' | 'section';
}
```

- Renders a spinner beside its `label` in a `role="status"` region.
- A page that uses it still renders its `h1` above it (FR-012).

## `PortalShell` (`@discava/common-shadcn/components/portal-shell`), changed

- **Breadcrumbs:**
  - The root crumb's text is "Home".
  - A crumb is a link only when `router.matchRoutes(href)` ends in a real route. Otherwise it is rendered as text (`BreadcrumbPage`), never as `href="#"`.
  - Crumbs wrap (`break-words`), and links are at least 24px tall.
- **`getBreadcrumbs` API:** it takes `routeExists: (href: string) => boolean` in place of `availableRoutes`, which no caller passes.
- **Focus:** it renders `RouteAnnouncer` with its content area's id and the current pathname.
- **Phone sidebar:** it closes when the pathname changes. When closed with Escape or its close button, focus returns to `SidebarTrigger`.
- **Portals:** the admin portal gains all of the above without changes of its own.

## `DialogContent` (`ui/dialog.tsx`), changed

- Its grid has one `minmax(0,1fr)` column, so no content can make it wider than `max-w-[calc(100%-2rem)]`.
- The close button is at least 24px by 24px; the icon stays 16px.

## `Checkbox`, `RadioGroupItem`, `Switch` (`ui/`), changed

- Each has a hit area of at least 24px by 24px; the visible size is unchanged.
- `Label htmlFor` remains the way to make the text part of the target.

## `PostCard` (`discussion/post-card.tsx`), changed

```ts
headingLevel?: 2 | 3 | 4; // default 4, as today
```

- Its title and author name can shrink and wrap (`min-w-0 break-words`), inside a dialog or a list at any width.

## `NotificationPreferences` (`components/notification-preferences.tsx`), changed

- **Failed save:** shown with `apiErrorMessage`, beside the switch that was changed, and the switch keeps focus.
- **Failed load:** `ErrorAlert` with `onRetry`.
- **Loading:** `LoadingState` ("Loading your notification settings…").
- **Switch names:** each switch's visible name is a `Label` for it, so the text is part of the target.
