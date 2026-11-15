# Contract: instructor-api `earnings` router

Both are `protectedProcedure`s of instructor-api (caller must be in the `instructor` group, else `FORBIDDEN`). The instructor is always `ctx.user.sub`, never an input, so every read is inside that instructor's own partition. No output carries buyer identity (`userId`, email, name).

## `earnings.report` (query)

Input: `{ from: string /* YYYY-MM-DD, UTC */, to: string /* YYYY-MM-DD, UTC, inclusive */ }`

Output: `{ currencies: { currency: string, courses: { courseId: string, courseTitle: string, orders: number, grossMinor: number, discountMinor: number, refundMinor: number, feeMinor: number, netMinor: number }[], totals: { orders, grossMinor, discountMinor, refundMinor, feeMinor, netMinor } }[] }`

- `to` before `from`, or a range over 366 days, gets `BAD_REQUEST` ("Choose a period of at most 366 days that ends after it starts").
- One query over `earningDay` for the range; rows are grouped by currency, then course. Courses with no activity are omitted; an instructor with none gets `{ currencies: [] }` (the portal shows the empty state).
- Every row and every total satisfies `gross - discount - refund - fee = net`. A unit test asserts it over generated data, and that totals equal the sum of the rows.
- Course titles come from keyed gets of the instructor's own courses.

## `earnings.lines` (query)

Input: `{ courseId: string, from: string, to: string, cursor?: string }` (same date rules)

Output: `{ lines: { entryId, kind: 'sale' | 'refund', orderId, occurredAt, currency, grossMinor, discountMinor, refundMinor, feeMinor, netMinor }[], nextCursor?: string }`

- Range query on the instructor's `L#<courseId>#` keys between the dates, 50 per page. A course the instructor has no entries for returns an empty page (indistinguishable from not owning it).
- The lines of all pages for a course and period sum to that course's report row (a test pins this).
