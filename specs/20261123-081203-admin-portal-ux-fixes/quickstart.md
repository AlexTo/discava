# Quickstart: checking the admin portal UX fixes

How to check each story by hand on the local stack. The automated checks are the component tests beside each changed file and the e2e scenarios named in [tasks.md](./tasks.md). This guide is for the reviewer, and for the **(human)** tasks.

## Prerequisites

1. Start Docker, then run `pnpm dev`, which serves the admin portal at <http://localhost:4202>.
2. Sign in as **Carol** (admin), or under "Someone else" as a new user with the `admin` group.
3. Make the audit's data (the e2e helpers in `packages/e2e/src/helpers/` do it through the API; `LOCAL_DEV=true` for the ones that write to the table):
   - a category whose name is one 60-character word (`createCategory`);
   - a published course with a dozen reviews, some 500 characters ending in a 70-character word, a few with instructor responses (`createReviewedCourse`, `postReview`);
   - a certificate earned by a learner with a 40-character name, revoked and restored with 500-character notes (`helpers/certificate.ts`);
   - Stripe connected (Payments, key `sk_test_local`), then replaced a few times.
4. Have two browser windows: **375×812** and **1440×900**. Keep a way to block requests (DevTools Network → Block request URL `localhost:2025`, or offline mode). Failed loads retry for about 7 seconds before their error shows.

Throughout:

- **Sideways scroll** means `document.documentElement.scrollWidth > clientWidth`.
- **Focus** means `document.activeElement` in the console.

## US1: every admin page fits a phone

At 375px:

1. Categories: no sideways scroll. Each row shows the name, then "Slug: science", then "Active · Courses: 20", then Rename and Archive. Rename the long-named category: the field, Save and Cancel are on screen.
2. Reviews, with the course chosen: no sideways scroll; long words in reviews and responses wrap.
3. Certificates, with the certificate looked up: no sideways scroll; Revoke is below the learner's details. History entries are visibly separate.
4. Payments: Recent changes shows "Mode" and "Key" apart, dates on one line, and the table scrolls inside itself.
5. At 1440px, all four look as they do on `main`, apart from long words wrapping.

## US2: links, breadcrumbs and home

1. On Branding, the trail reads "Home › Settings › Branding"; "Settings" isn't a link.
2. Open `/settings` and `/no-such-page`: "Page not found" shows in the shell, with a link home.
3. Home has six cards, each opening its page.

## US3: where you are

1. Each page's tab title matches [contracts/page-titles.md](./contracts/page-titles.md).
2. Follow a sidebar link with Enter: focus is on the new page's `h1`.
3. Delay `localhost:2025` (or reload on a slow connection): each page says what it is loading, in words.
4. Open the portal in a private window: the wait says "Signing you in…" in the middle of the page.

## US4: the keyboard keeps its place

With the keyboard alone, do each action and check focus afterwards:

| Action | Focus afterwards | Announced |
|--------|------------------|-----------|
| Add category (button, duplicate name) | Add category | the error, beside the field |
| Rename, then Escape | that row's Rename | none |
| Rename, Save | that row's Rename | "Renamed to …" |
| Archive, confirm | that row's Rename | "… archived." |
| Remove review: Cancel, Escape | that review's Remove | none |
| Remove review: submit | the review's row ("Removed") | "Review removed." |
| Load more | the first review it loaded | none |
| Revoke: Cancel; submit | Revoke; Restore | none; "Certificate revoked." |
| Replace key, Cancel | Replace key | none |
| Connect Stripe or Save key, succeeding | Replace key on the status card | "Stripe connected." / "Key replaced." |
| Disconnect, confirm | the key field | "Stripe disconnected." |
| Replace key, Save key, Keep the current key | the empty key field | none |
| Disconnect, Keep connected | Disconnect | none |
| Branding Save | Save | "Branding saved…" |
| Phone sidebar: choose a page; Escape | the page's `h1`; the sidebar button | the page's name |

Type in the Reason and Note fields: the counters are not read on each key.

## US5: typed work

1. Type a reason in Remove review, press Escape: "Discard unsaved changes?" asks. Keep editing returns to the field with the text.
2. Same for a click outside, and for Revoke's note.
3. Cancel, then reopen: the field is empty.
4. Change the branding name, then click Categories in the sidebar: the portal's "Leave without saving?" dialog asks.

## US6: errors

1. Block `localhost:2025` and open each page: each failed load has a heading and one Try again. Unblock and press it: the content replaces the error.
2. Submit each form empty (Add category, Rename, Look up, Remove review, Revoke with Other, Save key): the problem shows by its field, the field is focused, and no request is sent (Network panel).
3. Add a category that exists: the message is under the add form, not at the top.
4. Block requests and confirm an archive: the error shows inside the confirmation, which stays open.
5. Look up `NOPE-NOPE-NOPE-NOPE`: "No certificate has this ID" with what to check.
6. Block requests and toggle a notification setting: no "Failed to fetch".

## US7: views in the address

1. Choose a course on Reviews: the address has `?course=`. Reload, Back, Forward, open in a new tab: the same course's reviews.
2. Look up a certificate: the address has `?id=`. Same checks.

## US8: controls

1. Measure the dialog close buttons and the switches: at least 24×24px, and a switch's text toggles it.
2. List the Rename and Archive buttons' names: each names its category.
3. Branding's three image Reset buttons each name their image.
4. The replace confirmation says "Replace the key" and "Keep the current key".

## US9: rules and tests

1. `pnpm nx e2e @discava/e2e -- phone-width` passes. Revert the categories stacking locally: it fails on the admin case.
2. `packages/websites/CLAUDE.md` has the table check under "Layout".
