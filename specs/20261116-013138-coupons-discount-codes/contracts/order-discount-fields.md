# Contract: discount fields on the order

For #284 (which owns the `order` entity) and #286 (payouts, which reads it). Written once, when the order is created, and never edited.

| Field | Type | Meaning |
|-------|------|---------|
| `listAmount` | integer, minor units | the course's price when the order was made |
| `discountAmount` | integer, minor units | 0 without a code |
| `totalAmount` | integer, minor units | what the student is charged; `listAmount - discountAmount`; 0 for the free path |
| `currency` | string | the order's currency |
| `couponCode` | string, optional | the normalised code; absent without a code |
| `couponType` | `'percent' \| 'fixed'`, optional | as the coupon was when used |
| `couponValue` | integer, optional | percent, or minor units, as the coupon was when used |

Rules:

- `couponCode`, `couponType` and `couponValue` are all present or all absent; with them, `discountAmount` is what `priceWithCoupon` returned.
- A free-path order has `totalAmount` 0 and status `paid` (so #284's rule that access follows a paid order holds), and no Stripe session or payment.
- Refunds do not edit these fields; #286 reconciles refunds against `totalAmount`.
- For #286: gross is `listAmount`, discount is `discountAmount`, net before fees is `totalAmount`. Who bears a discount, and the platform fee on `totalAmount`, are #286's decisions. If #286 needs more (for example the instructor id at the time), it adds it to the order itself.
