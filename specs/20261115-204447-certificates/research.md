# Research: Course Completion Certificates

## R-1: Where to issue, and how to stay idempotent

**Decision**: Issue inside `recalculateStudent` (events), after the enrolment is known completed, by calling `issueCertificate` from core-table. Call it on every pass where the computed result is completed or the enrolment is already completed, the course has certificates on, and the student has not dropped.

**Rationale**: Completion is decided there. The enrolment patch (`status = 'active'` condition) lets one run win the transition, but a run that loses it, or a retry after the winner failed before issuing, must still issue. Keying the certificate by student and course and creating it conditionally makes every call safe. Issuing in core-api's `completeContentItem` was rejected: it does not decide completion, and a failure there would fail the learner's request.

**Alternatives**: a stream handler on the enrolment's MODIFY to completed (new filter, new event-source wiring, a third consumer of the table stream; redelivery handling would still need the same idempotent create). A transaction with the enrolment patch (loser never issues; a crash between would leave the student completed with no certificate and nothing to repair it).

**Failure**: a throw from `issueCertificate` fails the batch, which the event source mapping retries; the retry reaches the same step because the enrolment is already completed.

## R-2: Reading the course and the user

**Decision**: Two keyed gets (`course`, `user`) made only when the student is completed and has no certificate (one keyed get of the certificate first). Normal recalculations of in-progress students are unaffected.

**Alternatives**: carry `certificatesEnabled` and the title in the curriculum already loaded: `loadCurriculum` reads modules, lessons and items, not the course record, and changing it widens a shared function for one flag.

## R-3: Certificate ID

**Decision**: 80 random bits (`crypto.randomBytes(10)`) as 16 Crockford base32 characters, shown `XXXX-XXXX-XXXX-XXXX`. Normalise on input: strip dashes and spaces, uppercase, map `O`→`0`, `I` and `L`→`1`; reject anything not 16 characters of the alphabet without touching the table. Before the create, query the ID index for the new ID and regenerate on a hit (a handful of tries); the conditional create only guards the primary key, so uniqueness of the ID itself is checked this way, and an invariant (unique IDs) backs it up.

**Alternatives**: UUID v4 (122 bits but long and hard to type; the ID is printed on a PDF); sequential numbers (enumerable); a hash of student and course (stable but guessable if inputs are known, and leaks nothing useful anyway; rejected for enumeration risk).

## R-4: Public lookup index

**Decision**: Reuse `gsi1pk-gsi1sk-index` (already used by `enrolment.byUser`, `courseInstructor`-style patterns): `gsi1pk` = the certificate ID, `gsi1sk` = a constant composite. Query returns at most one item.

**Rationale**: constitution V: add an index only for a named access pattern, and a new index costs writes. A shared GSI is fine because ElectroDB prefixes each entity's key values. Verified at implement time with ElectroDB's `.params()` in a test (risk R2).

**Alternatives**: a second record keyed by ID (two writes to keep in step, needs a transaction); a new GSI (migration of the table definition for one pattern).

## R-5: PDF

**Decision**: `pdf-lib` with standard fonts, one landscape A4 page, drawn on demand in the shared router Lambda; returned base64 in the tRPC response (a few KB). Text outside WinAnsi becomes `?`.

**Rationale**: no storage, no lifecycle, no local stand-in (constitution III), and the certificate is a pure function of its record, so the PDF can't drift from the data. Bundle impact is about 400 KB.

**Alternatives**: store the PDF in S3 at issue time (a bucket policy, delete/lifecycle rules, a failure state if drawing fails, S3Mock for local; no benefit at this size); Puppeteer/Chromium Lambda layer (heavy, slow cold starts, not "managed serverless simple"); client-side PDF drawing (works, but the server-authored copy is the authoritative one, and the PDF must match what verification shows). Unicode fonts via `fontkit` would remove the `?` limitation at the cost of shipping a font; deferred.

## R-6: Verification URL inside the PDF

**Decision**: `<allowed origin>/certificates/<ID>`, with the origin from `getAllowedOrigin` on the request; if unavailable, the PDF prints `/certificates/<ID>` with the site name. The shareable link copied in the portal uses `window.location.origin`.

## R-7: Setting storage and default

**Decision**: `certificatesEnabled` is a required boolean on `course`, written as `true` when a course is created and changed by instructor-api's setting procedure. Existing dev data is backfilled by hand (a one-off script or console edit before the entity change is deployed), so code never reads a missing value; no fallback, per the project's no-compatibility rule.

## R-8: Backfill

**Decision**: None. Spec Assumptions. Anyone completed while a course was off stays without a certificate.
