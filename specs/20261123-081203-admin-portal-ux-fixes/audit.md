# Audit: Admin Portal UX (2026-11-23)

The findings this feature fixes, one line each. [spec.md](./spec.md) groups them into user stories, and [research.md](./research.md) gives the root cause and fix for each group.

**How it was done.** A scripted walk (Playwright) of every admin-portal page and dialog on the local stack (`pnpm dev`), signed in as a new administrator, with data made for the audit:

- 8 extra categories, one named with a 60-character word (the longest name the form takes);
- a published course whose 80-character title holds a 70-character word, with 23 reviews from 23 students: every third one 500 characters ending in a 70-character word, every fourth answered by the instructor;
- a certificate earned by a student named "Bartholomew-Maximilian Featherstonehaugh-Wolfeschlegel" on a course with a long title, revoked and restored twice with 500-character notes;
- Stripe connected to the local stand-in, with a dozen recent changes.

Each screen was checked:

- at 375px and 1440px;
- loaded, loading (requests held for 6s), after a failed load (requests blocked until the retries were spent, about 7s) and with long content;
- with the keyboard alone, recording `document.activeElement` after each action;

against [packages/websites/CLAUDE.md](../../packages/websites/CLAUDE.md) and the Web Interface Guidelines. The code was then read against the same rules, to find each cause. The screenshots are in the git-ignored `tmp/screenshots/admin-portal-audit/`, the measurements in `tmp/admin-audit-results*.json`, and the throwaway script in `packages/e2e/tmp/audit/admin/`.

The audit ran on `main` at `5bccb5be`, before the instructor-portal Phase 1 and US1 merged (#892). That merge changed `DialogContent`'s column only; none of the admin dialogs overflowed before it, so no finding below changes.

**Severity**:

- **P1**: blocks a task on a phone or with the keyboard.
- **P2**: makes a task confusing or hard.
- **P3**: polish.

**Story**: the user story in [spec.md](./spec.md) that fixes the finding.

**Shared**: where the cause is in code the three portals share and the [instructor-portal UX fixes](../20261123-000428-instructor-portal-ux-fixes/tasks.md) already plan the fix, the instructor task that makes it ("IP T016"). This feature does not make those fixes again. It checks them in the admin portal, and its tasks that need them wait for them (see [tasks.md](./tasks.md) Dependencies).

Paths are relative to `packages/websites/admin-portal/src/` unless they start with `packages/`.

## Area A: the shell, sign-in, home, the not-found page, the restricted page

| ID | Sev | Where | Finding | Story | Shared |
|----|-----|-------|---------|-------|--------|
| A-01 | P2 | every route but `/settings/branding` | No route calls `usePageTitle`. Six of the seven pages, the not-found page and the restricted page are all titled "Discava" | US3 | |
| A-02 | P2 | shell | `PortalShell` doesn't mount `RouteAnnouncer`. After following a sidebar link, focus stays on the link and nothing is announced | US3 | IP T032 |
| A-03 | P2 | shell, 375px | The phone sidebar stays open after a page is chosen, with focus left on the link inside it. Closing it with Escape leaves focus on `<body>` | US4 | IP T040 |
| A-04 | P2 | shell | The first breadcrumb's text is "/", a 4×20px target | US2 | IP T016 |
| A-05 | P2 | `/settings/branding`, `/settings/notifications` | The "Settings" crumb links to `/settings`, which is a bare "Not Found" with no heading | US2 | IP T016 |
| A-06 | P2 | any address with no page (`/no-such-page`) | Plain "Not Found" text inside the shell: no `h1`, no link home, titled "Discava", and the crumb shows the raw segment "no-such-page". The router has no `notFoundComponent` | US2 | |
| A-07 | P2 | first load, sign-in redirect | A blank page with a 16px spinner in the corner and no words, while the runtime config, the brand and the sign-in load (`main.tsx` passes `<Spinner />` as both fallbacks) | US3 | |
| A-08 | P2 | `/` | Home lists three of the portal's six areas. Certificates, Payments and Branding have no card, and Branding is only reachable from the user menu | US2 | |
| A-09 | P3 | `/` | Each card is one link whose name is all of its text ("CategoriesAdd, rename and archive the categories courses sit in.16 active categories") | US8 | |
| A-10 | P2 | `/categories`, `/reviews` (both lists), `/certificates`, `/payments` | Loading is a bare 16px spinner with no words and no `aria-busy` | US3 | |

## Area B: categories

| ID | Sev | Where | Finding | Story | Shared |
|----|-----|-------|---------|-------|--------|
| B-01 | **P1** | `/categories`, 375px | The page is 1,003px wide. The five-column table doesn't shrink, so every Rename (x=843) and Archive (x=930) is off-screen, and the slug column holds the longest unbroken word | US1 | |
| B-02 | P2 | `/categories`, any width | A name with a long word runs out of its cell over the slug column; the rename field and its Save and Cancel are squeezed into the Name cell | US1 | |
| B-03 | P2 | `/categories`, failed load | `ErrorAlert` with no Try again | US6 | |
| B-04 | P2 | Add category, Rename, Archive | One alert above the form, headed "That didn't work", for all three actions. A duplicate name is shown there, not beside the field it concerns, and isn't tied to it. A failed archive closes its confirmation and shows its error behind it at the top of the page | US6 | |
| B-05 | P2 | Add category, Rename's Save | Both are `disabled` while the name is empty, with no reason given | US6 | |
| B-06 | P2 | Add category | Pressing Add category (rather than Enter in the field) on a duplicate leaves focus on `<body>`: the button is disabled while saving | US4 | |
| B-07 | P2 | Rename | Rename doesn't move focus into the name field. Save and Cancel unmount the row's form and leave focus on `<body>`. Escape does nothing | US4 | |
| B-08 | P2 | Archive | After archiving, and after a failed archive, focus is on `<body>`: the dialog has no trigger to return to, and the row's Archive button is gone | US4 | |
| B-09 | P3 | Add, rename, archive | Nothing announces that a category was added, renamed or archived | US4 | |
| B-10 | P3 | table | 17 "Rename" and 16 "Archive" buttons share their names; none says which category it acts on | US8 | |
| B-11 | P3 | New category name | The placeholder "e.g. Science" has no ellipsis | US8 | |

## Area C: reviews

| ID | Sev | Where | Finding | Story | Shared |
|----|-----|-------|---------|-------|--------|
| C-01 | **P1** | `/reviews`, 375px, a course chosen | The page is 455px wide: review text and instructor responses with a long word have no `break-words`. The reviewer's name and the response heading have none either | US1 | |
| C-02 | P2 | course and reviews, failed load | Hand-built error blocks (`<div role="alert">` and a "Try again" button) with no heading, instead of `ErrorAlert`'s `onRetry`. The Try again buttons are `disabled` while refetching, so focus drops to `<body>` | US6 | |
| C-03 | P2 | Remove review dialog | Remove review is `disabled` until a reason is typed, with no reason given | US6 | |
| C-04 | P2 | Remove review dialog | Escape or a click outside discards a typed reason without asking | US5 | |
| C-05 | P2 | Remove review dialog | Closing it by any means, and a successful removal, leave focus on `<body>`: it opens from state, with no trigger. Nothing announces the removal | US4 | |
| C-06 | P2 | Load more (last page) | The button removes itself and leaves focus on `<body>` | US4 | |
| C-07 | P2 | course picker | The chosen course isn't in the address, so a reload, Back or a shared link loses it | US7 | |
| C-08 | P3 | Reason counter | `aria-live` reads "n/200" on every keystroke | US4 | |
| C-09 | P3 | dialogs | The dialog close button is 16×16px | US8 | IP T073 |

## Area D: certificates

| ID | Sev | Where | Finding | Story | Shared |
|----|-----|-------|---------|-------|--------|
| D-01 | **P1** | `/certificates`, 375px, a certificate found | The page is 528px wide and Revoke sits at x=455, off-screen. The card's header is a `flex` row that doesn't wrap, and the learner's name and course title have no `min-w-0` or `break-words` | US1 | |
| D-02 | P2 | lookup, failed or not found | "Certificate not found" in a bare `<p role="alert">`, with no next step ("Check the ID…"). A failed lookup has no Try again | US6 | |
| D-03 | P2 | Revoke and Restore dialogs | Cancel, Escape and a successful revoke or restore leave focus on `<body>` (opened from state, and Revoke becomes Restore). Nothing announces the result | US4 | |
| D-04 | P2 | Revoke dialog | Escape or a click outside discards a typed note without asking | US5 | |
| D-05 | P2 | Revoke dialog | With "Other" chosen, Revoke certificate is `disabled` until a note is typed, with no reason given. Look up is disabled while the field is empty | US6 | |
| D-06 | P2 | lookup | The certificate ID isn't in the address: a reload empties the field and the result, and a link to a certificate can't be shared | US7 | |
| D-07 | P3 | Certificate ID field | Spell-checked and auto-completed, though it is a code | US8 | |
| D-08 | P3 | history, 375px | Entries with a 500-character note run together as one paragraph each, with no space between entries | US1 | |
| D-09 | P3 | Note counter | `aria-live` reads "n/500" on every keystroke | US4 | |

## Area E: payments

| ID | Sev | Where | Finding | Story | Shared |
|----|-----|-------|---------|-------|--------|
| E-01 | P2 | Recent changes, 375px | The cells have no horizontal padding: "Mode" and "Key" run together ("ModeKey"), dates wrap to two lines, and the table can't scroll within itself | US1 | |
| E-02 | P2 | Replace key, Save key, Connect Stripe, Disconnect | Each is `disabled` while a change runs, so focus drops to `<body>`. Connect Stripe and Save key say nothing while saving | US4 | |
| E-03 | P2 | Replace key's Cancel, the confirmation's Go back, Keep connected | Each leaves focus on `<body>`: Cancel unmounts the form, and the dialogs open from state | US4 | |
| E-04 | P2 | connect, replace, disconnect | Success is only shown by the card changing; nothing is announced | US4 | |
| E-05 | P3 | failed load | "Try again" is a hand-built button inside the alert's text, not `onRetry` | US6 | |
| E-06 | P3 | Save key, Connect Stripe | `disabled` until a key is typed, with no reason given | US6 | |
| E-07 | P3 | Replace confirmation | The buttons say "Continue" and "Go back", not what they do | US8 | |

## Area F: branding and notification settings

| ID | Sev | Where | Finding | Story | Shared |
|----|-----|-------|---------|-------|--------|
| F-01 | P2 | `/settings/notifications`, failed save | "Couldn't save. Failed to fetch" | US6 | IP T059 |
| F-02 | P2 | `/settings/notifications` | 13 switches at 36×20px whose text isn't part of the target | US8 | IP T073, T074 |
| F-03 | P2 | `/settings/branding` | Save is `disabled` while saving, so focus drops to `<body>`, and `disabled` while the form is invalid or unchanged, with no reason given beside it | US4, US6 | |
| F-04 | P2 | `/settings/branding`, leaving with changes | The question is the browser's own `window.confirm`, unlike the portal's dialogs | US5 | IP T052 |
| F-05 | P3 | `/settings/branding` | "Branding saved" is an `ErrorAlert` mounted with its text, so it may not be announced | US4 | |
| F-06 | P3 | `/settings/branding` | Three "Reset to default" buttons (logo, icon, share image) share a name | US8 | |
| F-07 | P3 | `/settings/branding` Reset all | Cancel leaves focus on `<body>` (opened from state) | US4 | |
| F-08 | P3 | `/settings/branding` | The "Show the name beside the logo" switch is 36×20px | US8 | IP T073 |
| F-09 | P3 | `/settings/branding` image fields | Found in the code, not the walk: each image's Reset to default is `disabled` while its upload runs, so focus on it drops to `<body>` | US4 | |

## Area G: tests

| ID | Sev | Where | Finding | Story | Shared |
|----|-----|-------|---------|-------|--------|
| G-01 | P2 | `packages/e2e` | No admin page is in `phone-width.e2e.ts`, so B-01, C-01 and D-01 pass CI. No e2e case covers the admin breadcrumbs or the admin not-found page | US9 | |

## Improvements suggested, not in this feature

Recorded for later features; [spec.md](./spec.md) Assumptions says why each is out:

- Search or type-ahead in the Reviews course picker, instead of a native select with "More courses".
- Unarchive a category.
- Notification settings that list only the notifications an administrator can receive (an admin-only user is offered "Assignment returned", "New assignment submissions" and other student and instructor notifications).
- Figures on the home page's Reviews, Certificates and Payments cards (they need requests the portal doesn't make today).
- A list of recently revoked certificates, so they can be found without an ID.
