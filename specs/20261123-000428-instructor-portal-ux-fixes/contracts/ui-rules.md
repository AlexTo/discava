# Contract: checks added to the UI rules

`packages/websites/CLAUDE.md` holds the portals' UI rules (from the student-portal feature). The audit found patterns those rules don't cover. The checks below are added to the sections named, as bullets in the same voice: each is a yes-or-no check that came from a defect the instructor-portal audit found.

Nothing here repeats a rule already in that file:
- `min-w-0` for truncating children;
- one `h1`;
- `apiErrorMessage`;
- `onRetry`;
- 24px targets;
- the name contains the visible text;
- `role="status"` for results.

The root `CLAUDE.md` conventions stay where they are. One step is added to "Check every changed screen this way".

---

## Additions to `packages/websites/CLAUDE.md`

### Under "Check every changed screen this way", replacing step 4

```markdown
4. Save screenshots of what you checked as the root `CLAUDE.md` says, and add the changed screen to its e2e scenario with `screenshot()`. A page with rows of controls or a dialog also gets `expectOnScreen` / `expectDialogFits` in `phone-width.e2e.ts`: `expectNoSidewaysScroll` passes when a card clips its content.
```

### Under "Layout"

```markdown
- A row that holds a title and controls wraps below `sm`: the title takes the full width (`min-w-0 basis-full break-words`) and the controls wrap onto the line below. A row inside an `overflow-hidden` card never relies on shrinking its title to fit.
- A dialog's content never makes it wider than the screen: `DialogContent` has a `minmax(0,1fr)` column, and nothing inside overrides it. A dialog's footer of actions wraps, so its primary action is on screen at 375px.
- Information is never only on hover: counts, reasons and full titles are visible text, or reachable by focus on a control that does something.
```

### Under "Links and navigation"

```markdown
- A route whose path has an id in it labels that crumb with `useBreadcrumbLabel` (the course's, assignment's or student's name). A crumb is never an id.
- The `h1` is rendered outside the loading and error branches, with a fallback name ("Course") until the data names the page. A route never renders its own `<main>`; the layout has it.
```

### Under "Keyboard and screen readers"

```markdown
- A button whose action is running is a `PendingButton`, never `disabled={isPending}`: disabling the focused button sends focus to `<body>`.
- An action that removes its own control (delete, archive, restore, dismiss, the last "Load more") focuses the neighbouring item, or the list's heading when none is left. A dialog with no trigger element uses `useReturnFocus`.
- A keyboard reorder announces the item by title and its new position ("Question 3 moved to position 2 of 12"), never an id, and keeps focus on the moved item's handle.
- `StatusMessage` is mounted before it has anything to say. A character counter or a clock is not a live region; tie a counter to its field with `aria-describedby`.
```

### Under "Errors and waiting"

```markdown
- A failed save keeps everything that was typed. Never reset a field in a `catch`.
- Cancel and Escape close a dialog through the same handler, which resets its form. A dialog holding typed or uploaded work uses `useDiscardGuard`; a page with its own Save buttons uses `useUnsavedChangesGuard`.
- Save is never disabled because a form is incomplete. On submit, focus the first invalid field; each error has an `id` its field references with `aria-describedby`, and the field has `aria-invalid`.
- A control that is unavailable says why in visible text beside it, never only in a `title` tooltip. A section that doesn't apply yet says so instead of showing a form the server will refuse.
- An empty list says which kind of empty it is: nothing yet (with the action that adds the first one), or a filter that hides everything (with a way to clear it).
- An error inside an open confirmation is shown in that confirmation, not in the dialog behind it.
```
