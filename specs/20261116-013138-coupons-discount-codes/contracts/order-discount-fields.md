# Contract: discount fields on the order

For #284's `order` entity (`packages/databases/core-table/src/entities/order.ts`, written only by `helpers/order.ts`) and #286 (payouts, which reads it). Written once, when the order is created, and never edited. #284 already has `listAmount` and `amount`; only the rows marked new are added.

| Field | Type | Meaning |
|-------|------|---------|
| `listAmount` | integer, minor units | existing: the course's `priceAmount` when the order was made |
| `amount` | integer, minor units | existing: what the student is charged (what Stripe is asked for); `listAmount - discountAmount`; 0 for the free path. #284's `order-shape` already allows 0 to `listAmount` |
| `currency` | string | existing: the order's currency (the course's `priceCurrency`) |
| `discountAmount` | integer, minor units, optional (new) | what `priceWithCoupon` took off; present only with a code, and then above 0 |
| `couponCode` | string, optional (new) | the normalised code |
| `couponType` | `'percent' \| 'fixed'`, optional (new) | as the coupon was when used |
| `couponValue` | integer, optional (new) | percent, or minor units, as the coupon was when used |

Rules:

- `discountAmount`, `couponCode`, `couponType` and `couponValue` are all present or all absent, so an existing order, which has none, is a valid order without a code and needs no backfill. With them, `discountAmount` is what `priceWithCoupon` returned.
- A free-path order has `amount` 0 and status `paid` (so #284's rule that access follows a paid order holds), `paidAt` set, no session, no `checkoutUrl` and no payment intent (`order-shape` asks for one only when `amount` is above 0). It still has `accountId` and `mode` from the active connection and `expiresAt` = when it was made, and raises the connection's `latestCheckoutExpiresAt` like any order (the existing `checkout-window-covers-orders` and `order-account-known` invariants apply to it).
- Refunds do not edit these fields; #286 reconciles refunds against `amount`. A free-path order is never refunded (nothing was charged).
- For #286: gross is `listAmount`, discount is `discountAmount ?? 0`, net before fees is `amount`. Its earnings recording already reads `listAmount` and `amount` and counts only orders with `amount` above 0 as sales, so it needs no change for this. Who bears a discount, and the platform fee on `amount`, are #286's decisions.
