# Contract: admin portal Payments page

Route `/payments` in `packages/websites/admin-portal` (a sidebar entry "Payments"), visible to administrators only; the portal already signs in with the admin group, and every procedure also checks it. Buttons carry text only (no arrow icons). Built with shadcn components from `@discava/common-shadcn`; the portal's API client is the generated admin-api connection.

| State (`payment.status`) | Shown |
|---|---|
| `not-connected` / `disconnected` | "Stripe isn't connected. Students can't buy courses until it is." A password-type field "Stripe secret key" and **Connect Stripe**. Short help: where to find the key and which permissions a restricted key needs (the list from research R-14's confirmation) |
| `active` | a status card: "Connected" with a **Test mode** or **Live mode** badge (test mode in a warning colour and a sentence "Students pay with test cards and are enrolled for free"), account name, "Key ending ····1234", "Changed by <name> on <date>". **Replace key** (reveals the field and **Save key**) and **Disconnect** (a confirmation dialog) |
| `changing` | "A change is in progress" with the status refreshed every 5 s; the buttons are disabled |
| `addressChanged` | an alert: "The address Stripe sends payment confirmations to has changed. Save the key again to register it." |
| open checkouts and a switch or disconnect is attempted | the `CONFLICT` message shown as an alert with the end time |
| below the card | "Recent changes": a table of the last 10 rows (when, who, what, mode, key ending, and for a failure the step in words) |

Rules: the key field is cleared after every save attempt, accepts no autofill (`autoComplete="off"`, `type="password"`), and the page never shows the key after the request leaves. Errors show the contract's fixed messages in an alert. Switching to an account whose name differs from the current one asks "This is a different Stripe account (<name>). Continue?" before the request is sent as the same call; the server decides again.

## Tests

Component tests: each state's content; the field is empty after success and after failure; test mode shows the badge and the warning; Disconnect asks for confirmation; a conflict shows the end time; no rendered text or DOM attribute contains the key a test typed. An e2e scenario (`payment-connection.e2e.ts`) covers Carol connecting against the stand-in, a student then buying, a switch refused with an open checkout and allowed after expiry, and Alice (instructor) getting `FORBIDDEN`.
