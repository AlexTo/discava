# Contract: admin-api `payment` router

Part of the shared `admin-api` (research R-19). Every procedure requires the caller to be in the `admin` Cognito group, otherwise `FORBIDDEN`. `payment.status` runs on the shared admin router (table reads only). `payment.connect` and `payment.disconnect` run on one dedicated function, `PaymentsConnect`, the only function that may write the two Stripe secrets.

No output, log line or error from any of these carries the key or the signing secret; the key arrives only in `connect`'s input and is never echoed.

## `payment.status` (query)

Input: none. Output:

```text
{
  state: 'not-connected' | 'active' | 'changing' | 'disconnected',
  mode?: 'test' | 'live',
  accountName?: string,
  keyLast4?: string,
  changedByName?: string, changedAt?: string,
  openCheckoutsUntil?: string,   // set while latestCheckoutExpiresAt is in the future
  addressChanged?: boolean,      // stored webhookUrl differs from the current one (R-17)
  changes: { kind, byName, at, mode?, keyLast4?, step? }[]   // latest 10 paymentChange rows
}
```

## `payment.connect` (mutation)

Input: `{ secretKey: string }`. Output: the same shape as `status`, plus `warning?: string` (a switch whose old registration could not be removed).

Order of work and failures are in research R-14. Errors (each `BAD_REQUEST` unless noted, each with a fixed message and never the key):

| Situation | Code | Message gist |
|-----------|------|--------------|
| not `sk_`/`rk_` + `test_`/`live_` | BAD_REQUEST | "This isn't a Stripe secret key" (a `pk_` key: "That's a publishable key; paste the secret key") |
| Stripe rejects the key | BAD_REQUEST | "Stripe rejected this key" |
| key lacks a needed permission | BAD_REQUEST | "This key can't create webhook endpoints" |
| registration fails (Stripe error, unreachable) | INTERNAL_SERVER_ERROR | "Couldn't register the confirmation address; nothing was changed" |
| other account while `now < latestCheckoutExpiresAt` | CONFLICT | "Checkouts are open until <time>; try again after" |
| lease held by a live change | CONFLICT | "Another change is in progress; try again in a minute" |
| a rotation lost a race on `revision` | CONFLICT | same as above |

Effects: same account, address unchanged: only the key secret and the record change. First, switched or address-changed: lease, remove leftover same-URL endpoints of ours, register, write signing secret then key, mark active (research R-14). A switch then removes the old endpoint with the old key, best effort. Every attempt appends a `paymentChange` row (`failed` rows carry the step). A save that fails after the lease was taken releases it (`abandonChange`) and leaves the earlier secrets and record as they were.

## `payment.disconnect` (mutation)

Input: none. Output: the `status` shape. Needs the lease (so `CONFLICT` while checkouts are open or another change runs), deletes the endpoint (best effort), overwrites both secrets with a placeholder, marks `disconnected`, appends a row. Disconnecting when nothing is connected is `BAD_REQUEST`.

## Tests

`payment.test.ts` (follow instructor-api's `course.test.ts`; Stripe and the secrets client are mocked): a non-admin and a signed-in instructor are `FORBIDDEN` on all three; connect with a good key stores the signing secret then the key and marks active; the secret writes never happen on a rejected key, a permission error, or a registration failure; a rotation writes one secret and does not register; a switch with an open checkout writes nothing and names the end time; two connects at once, one gets the lease conflict; a lease left by a crash is taken over after it expires and not before; a failed switch leaves the old secrets untouched; a `pk_` key and malformed input are refused without echoing them; no response, thrown error or log call contains the key (a test searches all of them for the key string); `status` never contains a secret; the audit rows are written for success and failure with at most four key characters.
