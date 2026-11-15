# Contract: core-api `certificate` router

All run on the shared router Lambda. `verify` is a `publicProcedure`-based operation and MUST be added to `PUBLIC_OPERATIONS` (`packages/apis/core-api/src/router.ts`) so API Gateway skips its authorizer; `router.test.ts` checks it. `myCertificates` and `pdf` are `protectedProcedure`s; the student is always `ctx.user.sub`, never an input.

## `certificate.verify` (query, public)

Input: `{ certificateId: string }` (any case, with or without dashes or spaces)

Output: `{ certificateId: string /* display form */, learnerName: string, courseTitle: string, completedAt: string }`

- Normalises the ID; a value not 16 characters of the alphabet gets `NOT_FOUND` without a table read.
- Queries the ID index; no result gets the same `NOT_FOUND` with the same message, "Certificate not found".
- Returns exactly those four fields: never `userId`, `courseId`, email or anything else. A test asserts the output has no other keys.

## `certificate.myCertificates` (query)

Input: none

Output: `{ certificateId, courseId, courseTitle, learnerName, completedAt }[]`, most recent first.

- Queries the student's certificates by key. Used by My Learning to show the action and the link.

## `certificate.pdf` (query)

Input: `{ courseId: string }`

Output: `{ fileName: string; contentBase64: string }`

- Reads `{ userId: ctx.user.sub, courseId }`; none gets `NOT_FOUND` (so another student's course is indistinguishable from none). No input can name another user.
- Draws one landscape A4 page: heading, learner name, course title, completion date, certificate ID, verification URL (R-6). `fileName` is `certificate-<ID>.pdf`. Characters WinAnsi cannot draw are replaced by `?`; long text shrinks to fit.
- Works for archived courses and with certificates later turned off.
