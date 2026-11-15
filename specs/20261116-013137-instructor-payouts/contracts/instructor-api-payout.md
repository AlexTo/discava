# Contract: instructor-api `payout` router

All `protectedProcedure`s of instructor-api; the instructor is `ctx.user.sub`.

## `payout.account` (query)

Input: none. Output: `{ status: 'not_started' | 'in_progress' | 'active' | 'restricted', stale?: boolean }`

- No stored account gives `not_started`. Otherwise it retrieves the account from Stripe, stores the mapped status (research R-6) and returns it. If Stripe is unreachable it returns the stored status with `stale: true` rather than failing the page.

## `payout.startOnboarding` (mutation)

Input: `{ returnPath: string }` (a path on the instructor portal; anything else is refused)

Output: `{ url: string }`

- Creates the Express account on first use (idempotent: one account per instructor; a repeat or concurrent call returns the same account), stores it, then creates a Stripe account link and returns its URL for the portal to redirect to. Used for Set up payouts, Continue setup and Fix account.

## `payout.dashboardLink` (mutation)

Input: none. Output: `{ url: string }`

- Only for an `active` or `restricted` account; creates a Stripe Express login link. Otherwise `PRECONDITION_FAILED`.

## `payout.overview` (query)

Input: none.

Output: `{ currencies: { currency, onHoldMinor, waitingMinor, readyMinor, nextReleaseAt?: string }[], payouts: { payoutId, currency, amountMinor, status: 'pending' | 'sent' | 'failed', failureReason?: string, createdAt, settledAt? }[] }`

- Derived from the instructor's open entries (`byOpen`) and their payouts (the statuses table in data-model.md). A negative open total is shown as a negative `readyMinor` (or `waitingMinor` when there is no active account), never hidden.
- Never returns another instructor's data; no input names an instructor.
