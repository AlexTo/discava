# Contract: instructor portal Earnings page

Route `/earnings` in the instructor portal (`src/routes/_authenticated/earnings/`), linked from the portal's navigation (`navItems` in `components/app-layout.tsx`). Buttons carry text only (no arrow icons).

- **Payout account card** (from `payout.account`): status label (Not set up, In progress, Active, Restricted) and one action: Set up payouts, Continue setup, Open Stripe dashboard, or Fix account. When the status is `unavailable` (the platform has not connected Stripe) the card says "Payouts aren't available yet" and has no action; earnings still show. Set up, Continue and Fix call `payout.startOnboarding` and redirect to the returned URL; Open Stripe dashboard calls `payout.dashboardLink`. On return from Stripe the page refetches the account.
- **Balance card** (from `payout.overview`): per currency, On hold (with the next release date), Waiting for account setup, Ready. A negative balance is shown as an amount to be deducted from the next payout, with an explanation. A Held line appears only when `heldMinor` is not zero, with the explanation "Earned before the platform changed its payment account. Contact the platform to be paid."
- **Period picker**: a month selector (default: the current UTC month) and a custom range. An invalid range shows the API's message inline.
- **Report table** (from `earnings.report`): one section per currency; a row per course with Orders, Gross, Discounts, Refunds, Platform fee, Net, and a Total row. Amounts are formatted for the order's currency. Empty state: "No sales in this period".
- **Course lines**: each row has a Show orders button that loads `earnings.lines` pages (Load more), showing Date, Order reference, Type (Sale, Refund), Gross, Discount, Refund, Fee, Net. No buyer is shown.
- **Payouts list** (from `payout.overview`): Date, Amount, Status (Pending, Sent, Failed with the reason).
- Loading and error states for each section; one failing section does not blank the page.
