# Data Model: Admin Portal UX Fixes

This feature stores nothing and changes no entity, index, schema or request. The core table and every API contract are as they were.

What it defines is browser-side state: what each admin screen holds while an action runs, and what two pages keep in the address. None of it outlives the address bar.

## The address

| Route | Param | Meaning | Contract |
|-------|-------|---------|----------|
| `/reviews` | `course` | the course whose reviews are shown | [url-state.md](./contracts/url-state.md) |
| `/certificates` | `id` | the certificate looked up | [url-state.md](./contracts/url-state.md) |

Both replace a `useState` the screen holds today (`courseId`, `lookedUp`). The input on screen mirrors the address, Back included.

## Categories screen

| State | Today | After |
|-------|-------|-------|
| `newName` | typed name; Add disabled when empty | typed name; Add always enabled, checks on submit |
| `addProblem` | none | the empty-name message, shown under the field until it changes |
| `renaming` | `{ id, name }` or none | unchanged |
| `renameProblem` | none | the empty-name message, under the rename field |
| `archiving` | the category in the confirmation; cleared on settle | cleared on success only, so a failure shows in the confirmation |
| errors | one `create.error ?? rename.error ?? archive.error` above the form | each mutation's error where it was taken (research R-11) |
| `status` | none | the last result sentence, for `StatusMessage` |

Focus targets after each action are found through a `Map<categoryId, HTMLButtonElement>` of Rename buttons, filled by ref callbacks.

## Reviews and Certificates dialogs

| Event | Nothing typed | Something typed |
|-------|---------------|-----------------|
| Cancel | closes, resets | closes, resets (Cancel is deliberate) |
| Close (X), Escape, click outside | closes, resets | asks "Discard unsaved changes?" (`useDiscardGuard`) |
| Submit with a problem | shows it by the field, focuses the field, sends nothing | same |
| Request fails | stays open, input kept, error inside | same |
| Request succeeds | closes; focus moves as research R-8 says; result announced | same |

`dirty` is "the reason (or note) is not empty after trimming". The Revoke dialog's reason select counts as typed only through its note.

## Payments screen

| State | Today | After |
|-------|-------|-------|
| `replacing` | the key form is open | unchanged; Cancel focuses Replace key |
| `pendingKey` | the key awaiting confirmation, in memory only | unchanged |
| key field | uncontrolled, emptied on submit | unchanged; a submit with it empty shows "Enter a Stripe secret key." and sends nothing |
| busy | `connect.isPending || disconnect.isPending` disables every button | the running action's button is a `PendingButton`; the others stay `disabled` only while `changing`, whose reason is the alert above them |

## Branding form

| State | Today | After |
|-------|-------|-------|
| Save | disabled when unchanged, invalid or saving | always enabled; invalid → focus the first invalid field; unchanged → "Nothing to save" announced; saving → `PendingButton` "Saving…" |
| leaving with changes | `useBlocker` with `window.confirm` | `useUnsavedChangesGuard(dirty)`, the portal's dialog |
