# Contract: instructor-api course price

## `course.setPrice` (mutation)

On `courseProcedure`. Input: `{ courseId: string, priceAmount: number, priceCurrency: string }`. Output: the course including `priceAmount`, `priceCurrency`.

- Validated with `validatePrice` from `@discava/common-web-utils/price`: an integer, `0` or 100 to 1,000,000, a currency in the list; anything else is `BAD_REQUEST` with the rule in the message.
- Allowed in any course status for the course's instructors; others get the same refusal as other course edits.
- Patches `priceAmount` and `priceCurrency`, sets `pricedAt` to now when going from `0` to non-zero, removes it when going to `0`, leaves it for a non-zero to non-zero change, and moves `updatedAt` and each instructor's `courseUpdatedAt` exactly as the other course edits do.
- Reads and writes no `order` or `enrolment`: a change never touches an order or an existing student's access.
- The patch is conditioned on the current amount it read, so two edits at once cannot leave `pricedAt` out of step with the amount (the loser retries from the new state or fails with `CONFLICT`).

## `course.create` (changed)

Writes `priceAmount: 0` and `priceCurrency: 'USD'` with the other required attributes (as it writes `certificatesEnabled: true`). Any seed or e2e/local-dev helper that writes a `course` does the same.

## Course reads (changed)

The instructor course read procedures return `priceAmount` and `priceCurrency`.

## Tests

`procedures/course.test.ts` (follow its pattern): an instructor sets, changes and clears a price; `pricedAt` appears on `0` to non-zero, stays on non-zero to non-zero, disappears on to-`0`; each invalid input is refused with nothing written; a non-instructor and a user outside the instructor group are refused; a draft and an archived course can be priced; `updatedAt` and `courseUpdatedAt` move; the order and enrolment entities are never called; a concurrent change that moved the amount is not overwritten blindly.
