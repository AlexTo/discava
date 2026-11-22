# Implementation Plan: Admin Portal UX Fixes

**Branch**: `20261123-081203-admin-portal-ux-fixes` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/20261123-081203-admin-portal-ux-fixes/spec.md`, and the findings in [audit.md](./audit.md)

## Summary

This is nine independent slices of presentation work, almost all in `packages/websites/admin-portal`, plus one optional prop in `packages/common/shadcn`, new admin cases in `packages/e2e`, and one rule in `packages/websites/CLAUDE.md`. No API, schema, entity, event handler, construct or stage setting changes. The portal makes the same requests as today, with the same inputs.

The admin portal is small (seven pages, about 2,700 lines), and its 56 findings come down to the causes the instructor-portal audit already found, on fewer screens:

- **Tables that can't shrink** (B-01, E-01) and **text with nothing to break on** (B-02, C-01, D-01): no wrapping, no `min-w-0`, no `break-words` (R-1 to R-3).
- **`disabled={isPending}`** on the focused button (R-7), and **dialogs opened from state** with no trigger to return focus to (R-8).
- **Buttons disabled to mean "not ready"**, with no reason (R-12).
- **Errors where the user isn't looking:** one alert for three mutations, a confirmation that closes on failure, hand-built retry blocks (R-11).
- **No titles, no not-found page, bare spinners** (R-5, R-6).
- **`useState` for views a link should carry** (R-13).

The plan fixes each where it lives. The shared pieces it needs are on `main` since #892 (`PendingButton`, `useReturnFocus`, `StatusMessage`, `LoadingState`, `expectOnScreen`).

**What the instructor-portal UX spec ("IP") fixes for this portal.** Nine findings are in shared code that IP's later stories change: breadcrumbs (T016), the route announcer (T032), the phone sidebar (T040), the discard and leave guards (T051, T052), notification settings (T059) and control sizes (T073, T074). This plan does not change those files again. Its tasks that rely on them wait for them, and add the admin tests that show them working ([contracts/shared-components.md](./contracts/shared-components.md)).

What the code showed that the audit could not:

1. **The categories table has no wrapper at all.** Not even `overflow-x-auto`: the page, not the table, scrolls, so the sidebar trigger and the user menu also leave the screen while renaming (the audit measured them at x=−616 and x=−309 after the page scrolled).
2. **One alert serves three mutations.** `create.error ?? rename.error ?? archive.error` shows whichever failed last, above the form, and Archive's `onSettled` closes its confirmation before the error is seen.
3. **The admin portal already calls `apiErrorMessage` everywhere**, so no raw message reaches the screen from admin code. "Failed to fetch" comes only from the shared `NotificationPreferences`, which IP T059 fixes.
4. **`CognitoAuth` renders its own bare spinner** with no way to replace it, so the sign-in wait can't say anything without a shared change (R-6).
5. **Every admin page already has one `h1` and one `main` in each state**, because the routes render their heading outside the loading and error branches and never render a `main`. Only the router's not-found fallback lacks a heading.

## Technical Context

**Language/Version**: TypeScript; React 19 + Vite portals; pnpm/Nx monorepo

**Primary Dependencies**:

- TanStack Router (`validateSearch`, `notFoundComponent`, `defaultNotFoundComponent`, `Link`) and TanStack Query
- `@discava/common-shadcn` (shadcn/ui on Radix, Tailwind)
- zod (search params, as the other portals use it)

No new dependency.

**Storage**: N/A. No record is read or written in a new way

**Testing**: vitest with Testing Library (`admin-portal`, `common-shadcn`); Playwright e2e in `packages/e2e`

**Target Platform**: browsers, at 375px and 1440px wide; `pnpm dev` locally; CloudFront when deployed

**Project Type**: web application (frontend only for this feature)

**Performance Goals**: no added request; layout is CSS

**Constraints**:

- same requests, same inputs, same moments (FR-028);
- shared fixes land in shared packages, once (FR-030);
- text-only buttons (FR-029);
- desktop layout unchanged apart from long-content fixes (US1 scenario 8);
- the Stripe key never stays in the page (spec Assumptions);
- no `ui/` shadcn file changes in this feature

**Scale/Scope**: about 20 admin-portal source files and their tests, 1 shared file (`cognito-auth.tsx`), 2 e2e scenarios, 1 rules file. 9 user stories, each one pull request.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Result | Notes |
|-----------|--------|-------|
| I. AWS-native, serverless | Pass | No backend or infrastructure change |
| II. Generators first | Pass | Nothing is scaffolded. One component (`not-found-page.tsx`) is added to the portal's existing `components/` folder; no shadcn registry item is added and no `ui/` file changes |
| III. Everything runs locally | Pass | Every story is exercised under `pnpm dev`; the audit itself ran there |
| IV. Layered tests | Pass, planned | Component tests for each changed screen and for `CognitoAuth`'s new prop. E2e: an admin section in `phone-width.e2e.ts` and an admin case in `breadcrumbs.e2e.ts`. No invariant work: see the impact check |
| V. Single-table via ElectroDB | Pass | Not touched |
| VI. Secure by default | Pass | The Stripe key is still emptied on every submit and never rendered. The `?id=` certificate address holds a public certificate ID, which the student portal already shows in its own public URL. No admin-only data enters the address |
| VII. Change freely before launch | Pass | Button names change outright ("Rename Science", "Replace the key"); tests and e2e helpers that used the old names change with them |
| VIII. Repo conventions | Pass | Route-private code stays in `-components/`; kebab-case files; text-only buttons; `screenshot()` on changed e2e screens |

No violations, so Complexity Tracking is empty.

**Impact check (constitution IV).** This feature writes no shared record and reads none in a new way.

- "Try again" repeats queries the pages already make.
- The views read from the address send the same inputs the picker and the lookup send today.
- Checks moved from `disabled` to submit send nothing when they fail, as the disabled buttons sent nothing.

No invariant is added or extended, and `entity-writers.json` does not change.

**Tests that change meaning (constitution IV, "tests are a specification").** These existing expectations describe behaviour this spec changes on purpose. Each is named in its task.

| Test | What it asserts today | Change, and the requirement behind it |
|------|----------------------|---------------------------------------|
| `admin-portal` `categories-screen.test.tsx` | buttons found by the names "Rename" / "Archive" (exact, within a row) | names are "Rename <name>" / "Archive <name>" (FR-026). It has no assertion on disabled buttons or the combined alert; the new behaviour gets new tests |
| `admin-portal` `reviews-screen.test.tsx` | Remove review is disabled with no reason; Try again is a plain button | enabled with a check on submit (FR-022); `ErrorAlert`'s Try again (FR-020) |
| `admin-portal` `certificates-screen.test.tsx` | Look up and Revoke certificate (Other) are disabled; "Certificate not found" | enabled with checks (FR-022); the not-found sentence (FR-023) |
| `admin-portal` `payments-screen.test.tsx` | the replace confirmation's buttons are "Continue" / "Go back"; Try again is found inside the alert | "Replace the key" / "Keep the current key" (FR-026); `ErrorAlert`'s Try again (FR-020). Its `toBeDisabled()` for Replace key and Disconnect while `changing` stays true |
| `admin-portal` `settings/-branding.test.tsx` | Save disabled when unchanged or invalid; `window.confirm` on leaving | enabled, checks on submit (FR-022); the portal's leave dialog (FR-018) |
| `admin-portal` `-index.test.tsx` | three area cards | six (FR-006) |
| `admin-portal` `components/app-layout.test.ts` | the root crumb is `'/'`; `getBreadcrumbs` takes `availableRoutes` | "Home"; `routeExists`. IP T016 changes the signature and should update this test; if it hasn't, T012 does |
| e2e `branding.e2e.ts` | Save is `toBeDisabled()` when unchanged or invalid (lines 54, 63, 88, 210, 300) | Save is enabled; an invalid form shows its problem on submit (FR-022) |
| e2e `review.e2e.ts` | Remove review is `toBeDisabled()` with no reason (lines 169-170) | enabled; submitting empty shows the problem by the field (FR-022) |
| e2e `payment-connection.e2e.ts` | the replace confirmation's button is "Continue" | "Replace the key" (FR-026). `category.e2e.ts`'s "Rename" and "Archive" still match "Rename <name>" and "Archive <name>", since Playwright matches names by substring; it needs no change |

## Project Structure

### Documentation (this feature)

```text
specs/20261123-081203-admin-portal-ux-fixes/
├── audit.md             # The 56 findings, by area and ID
├── plan.md              # This file
├── research.md          # Decisions R-1 to R-16
├── data-model.md        # Browser-side state per screen, and the address
├── quickstart.md        # How to check each story
├── contracts/
│   ├── shared-components.md   # CognitoAuth's fallback prop; the shared pieces used, and which IP tasks they wait for
│   ├── page-titles.md         # The title of every admin page
│   ├── url-state.md           # ?course= on Reviews, ?id= on Certificates
│   └── ui-rules.md            # The table check added to packages/websites/CLAUDE.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
packages/common/shadcn/src/components/
└── cognito-auth.tsx (+ test)          # optional fallback prop

packages/websites/admin-portal/src/
├── main.tsx                           # LoadingState fallbacks, CognitoAuth fallback
├── router.ts                          # defaultNotFoundComponent
├── components/not-found-page.tsx (+ test)   # new
└── routes/
    ├── __root.tsx                     # notFoundComponent; restricted page title
    ├── index.tsx                      # six cards, card names, title
    ├── categories/index.tsx, categories/-components/categories-screen.tsx
    ├── reviews.tsx (validateSearch), -components/reviews-screen.tsx
    ├── certificates.tsx (validateSearch), -components/certificates-screen.tsx
    ├── payments.tsx, -components/payments-screen.tsx, -components/payments/{changes-table,connect-form,status-card}.tsx
    └── settings/{branding,notifications}.tsx, settings/-components/{branding-form,image-field}.tsx
    (tests beside each file)

packages/e2e/src/
├── scenarios/phone-width.e2e.ts       # admin section
├── scenarios/breadcrumbs.e2e.ts       # admin case
├── scenarios/payment-connection.e2e.ts   # "Replace the key"
├── scenarios/{branding,review}.e2e.ts   # enabled Save and Remove review
├── scenarios/admin-portal.e2e.ts       # new: a screenshot per changed screen
└── helpers/certificate.ts             # a certificate with long names, through the API, for the phone case

packages/websites/CLAUDE.md            # the table check (contracts/ui-rules.md)
```

**Structure Decision**: No new package. The not-found page goes in the portal's existing `components/` (beside `app-layout.tsx`), since the root route and the router both use it. Everything else stays in the route's own `-components/`.

**Delivery**: One pull request per user story, after Phase 1.

- **Phase 1 goes first:** `CognitoAuth`'s prop and the admin e2e data helper, which several stories use.
- **Stories waiting on IP** (see tasks.md Dependencies):
  - US2's breadcrumb half waits for IP T016; its not-found page and home cards don't.
  - US3's focus-on-navigation check waits for IP T032.
  - US4's phone sidebar check waits for IP T040.
  - US5 waits for IP T051 and T052.
  - US6's notification-settings check waits for IP T059.
  - US8's size checks wait for IP T073 and T074.

  Each such task says what to do if its IP task hasn't merged: land the rest of the story and leave the check for a follow-up issue, named in the pull request.
- **Pairs that touch the same files are easier in sequence:** US1 before US4 and US6 (`categories-screen.tsx`, `certificates-screen.tsx`, `reviews-screen.tsx`).
- **US9's rule can merge any time.** Its e2e admin section grows with US1.

## Complexity Tracking

No violations.
