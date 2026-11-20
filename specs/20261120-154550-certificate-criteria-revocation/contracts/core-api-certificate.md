# Contract: core-api `certificate` router

Changes to the router #276 added (`packages/apis/core-api/src/procedures/certificate.ts`, `schema/certificate.ts`). `verify` stays the only public operation; `requirements` is new and protected. The student is always `ctx.user.sub`.

## `certificate.verify` (query, public), changed

Input: unchanged, `{ certificateId: string }`.

Output: one of two shapes, told apart by `status`.

```ts
// A valid certificate
{
  status: 'valid',
  certificateId: string,     // display form
  learnerName: string,
  courseTitle: string,
  completedAt: string,
  completedOn: string,       // as today
  statement: string[],       // research R-12, in order; at least one line
}

// A revoked certificate
{
  status: 'revoked',
  certificateId: string,     // display form
  revokedAt: string,
  revokedOn: string,         // formatted like completedOn
}
```

- Malformed or unknown ID: `NOT_FOUND`, "Certificate not found", exactly as today.
- The revoked shape carries no name, title, statement, reason, role or note. A test asserts each shape has exactly these keys.
- `statement` comes from `assessmentStatement(certificate.assessment)`. `assessedItems`, `criteriaVersion`, `userId` and `courseId` never appear in any shape.

## `certificate.myCertificates` (query), changed

Each item gains:

```ts
status: 'valid' | 'revoked',
revokedAt?: string,
revocationReason?: 'academic-integrity' | 'issued-in-error' | 'other' | 'refunded',
```

Revoked certificates stay in the list, so My Learning can say what happened. Every consumer that offers an action on a certificate (#592 included) must check `status`.

## `certificate.pdf` (query), changed

- A revoked certificate: `PRECONDITION_FAILED`, "This certificate has been revoked". No bytes are drawn.
- A valid one: the page gains the `statement` lines under the course title, drawn by `drawCertificatePdf({ …, statement })`. Long lines wrap; the page stays one landscape A4 page.

## `certificate.requirements` (query, protected), new

Input: `{ courseId: string }`

Refused unless the caller has an enrolment in the course that is not `dropped`, with the same error core-api's `requireEnrolment` gives the other enrolled-only procedures.

Output:

```ts
{
  certificatesEnabled: boolean,
  certificate: null | {
    certificateId: string,              // display form
    status: 'valid' | 'revoked',
    revokedAt?: string,
    revocationReason?: /* as above */,
  },
  allMet: boolean,
  requirements: Array<
    | { kind: 'complete-items', met: boolean, done: number, total: number }
    | { kind: 'pass-quizzes', met: boolean, done: number, total: number, items: QuizItem[] }
    | { kind: 'graded-uploads', met: boolean, done: number, total: number, minScorePercent: number, items: UploadItem[] } // Phase 8
  >,
}

type QuizItem = {
  contentItemId: string, lessonId: string, title: string,
  state: 'passed' | 'not-attempted' | 'not-passed' | 'no-attempts-left',
};
type UploadItem = {
  contentItemId: string, lessonId: string, title: string,
  state: 'met' | 'not-submitted' | 'awaiting-grade' | 'below-score',
  scorePercent?: number,   // the student's own, only for 'met' and 'below-score'
};
```

- Reads, all keyed: the enrolment, the course, the curriculum collection, the student's certificate for the course, their item completions and their `quizSummary` records for the course (Phase 8: their submissions for the course).
- `requirements` is `evaluateCertificateCriteria`'s output; this procedure computes nothing of its own (FR-008). `complete-items` is met when the enrolment is `completed`, whatever was added since.
- With `certificatesEnabled: false` it returns `requirements: []`, `allMet: false`, `certificate` as stored.
- `pass-quizzes` is present only when `requireQuizPass`; it lists every assessed quiz, passed ones included, in curriculum order.
- It returns the student's own data only, and writes nothing.
