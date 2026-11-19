# Contract: instructor-api `payout` router

All `protectedProcedure`s of instructor-api; the instructor is `ctx.user.sub`.

Every procedure works inside the *current payment account*: the `accountId` and `mode` of the `paymentConnection` record (#284), read on each call. The Stripe calls use the administrator's saved key through `common-server-utils/stripe`, after checking the key belongs to that account and mode. When the connection is not `active` (never connected, disconnected, or a change in progress), nothing here calls Stripe.

## `payout.account` (query)

Input: none. Output: `{ status: 'unavailable' | 'not_started' | 'in_progress' | 'active' | 'restricted', stale?: boolean }`

- No `active` connection gives `unavailable`. No stored account for the current payment account gives `not_started` (also after the platform changed its Stripe account or mode: the instructor sets up again, R-12). Otherwise it retrieves the account from Stripe, stores the mapped status (research R-6) and returns it. If Stripe is unreachable it returns the stored status with `stale: true` rather than failing the page.

## `payout.startOnboarding` (mutation)

Input: `{ returnPath: string }` (a path on the instructor portal; anything else is refused)

Output: `{ url: string }`

- Creates the Express account on first use (idempotent: one account per instructor and payment account; a repeat or concurrent call returns the same account), stores it, then creates a Stripe account link and returns its URL for the portal to redirect to. Used for Set up payouts, Continue setup and Fix account.
- No `active` connection is `PRECONDITION_FAILED` ("Payouts aren't available yet"). A key that Stripe refuses for Connect (the platform has not enabled Connect, or a restricted key lacks the permission) is `PRECONDITION_FAILED` ("This platform can't set up payout accounts yet") and logs an error for the operator; the key is never echoed.

## `payout.dashboardLink` (mutation)

Input: none. Output: `{ url: string }`

- Only for an `active` or `restricted` account of the current payment account; creates a Stripe Express login link. Otherwise `PRECONDITION_FAILED`.

## `payout.overview` (query)

Input: none.

Output: `{ currencies: { currency, onHoldMinor, waitingMinor, readyMinor, heldMinor, nextReleaseAt?: string }[], payouts: { payoutId, currency, amountMinor, status: 'pending' | 'sent' | 'failed', failureReason?: string, createdAt, settledAt? }[] }`

- Derived from the instructor's open entries (`bySettlement`) and their payouts (the statuses table in data-model.md). Open entries of the current payment account go to `onHoldMinor`, `waitingMinor` or `readyMinor`; open entries of any other payment account go to `heldMinor` (with no `active` connection, every open entry does). A negative open total is shown as a negative `readyMinor` (or `waitingMinor` when there is no active account), never hidden.
- `payouts` lists the instructor's payouts of every payment account, newest first. A `collecting` payout is listed as `pending`; a `releasing` one is listed as `failed` when it has a reason and otherwise left out (it never reached a transfer).
- Never returns another instructor's data; no input names an instructor.
