# Contract: portal UI

Buttons are text only, with no arrow icons. Texts below are the ones tests look for.

## Student portal

### Course home: "Certificate" panel (`learn/$courseId/-components/certificate-requirements.tsx`, mounted in `course-home.tsx`)

Calls `certificate.requirements`. Shown to an enrolled student only.

| State | Shows |
|-------|-------|
| Certificates off | nothing |
| Loading | a skeleton |
| Requirements unmet | heading "Certificate"; one row per requirement with a met or not-met mark and its count ("Complete every item: 12 of 14", "Pass every quiz: 2 of 3"); under an unmet quiz requirement, each quiz not passed as a link to its lesson with its state: "Not attempted", "Not passed yet", or "Not passed, no attempts left. Ask your instructor for another attempt." |
| All met, no certificate yet | "Your certificate is being prepared." The query refetches every few seconds for up to a minute |
| Certificate valid | "You earned a certificate" and the same View, Download PDF and Copy link actions as My Learning (the existing `certificate-actions.tsx`, moved to a shared place in the portal) |
| Certificate revoked | "Your certificate was revoked on <date>. Reason: <category>." No actions |
| Error | a retryable message; the rest of the course home is unaffected |

Phase 8 adds the row "Graded assignments returned with at least 60%: 0 of 1" and item states "Not submitted", "Waiting to be graded" and "Returned with 45%; 60% needed".

### Verification page `/certificates/$certificateId`

| State | Shows |
|-------|-------|
| Valid | as today, plus a "What this certificate confirms" list of the `statement` lines |
| Revoked | heading "Certificate revoked"; "This certificate has been revoked and is no longer valid."; the certificate ID; "Revoked on <date>". No name, course, statement or reason. No link to anything about the learner |
| Not found, loading, error | as today |

### My Learning (`my-learning/-components/certificate-actions.tsx`)

- Valid: unchanged.
- Revoked: in place of the Certificate control, the text "Certificate revoked on <date>. Reason: <category>." No View, Download PDF or Copy link.

Reason categories as shown to the learner: "Academic integrity", "Issued in error", "Order refunded", "Other".

## Instructor portal

### Certificate criteria (`…/my-courses_/$courseId/-components/course/course-certificate-criteria.tsx`, under the certificates switch)

- A checkbox "Require passing every quiz", with the note "Quizzes with a pass mark of 0% don't count. Applies to students who don't have a certificate yet; certificates already issued are not affected. Students who qualify after this change get their certificate automatically."
- Disabled, with its value kept, while "Issue a certificate on completion" is off.
- Saves on change through `course.setCertificateCriteria`; a failure shows the API's message and restores the previous value.
- Phase 8 adds a checkbox "Require graded assignments to be returned with at least" and a percentage field (1 to 100).

### A course's certificates (`…/-components/course/course-certificates-list.tsx`, a "Certificates" section on the course page)

- A table: learner name, certificate ID, completed, status ("Valid" or "Revoked on <date>: <reason>"), and a **Revoke** or **Restore** button per row. "No certificates yet" when empty. **Load more** when there is a next page.
- **Revoke** opens a dialog: a reason select (Academic integrity, Issued in error, Other), a note field (required for Other, 500 characters), the sentence "The public page will say this certificate has been revoked, and the student will be told." and **Revoke certificate** / **Cancel**.
- **Restore** asks for confirmation. It is not offered when an administrator revoked the certificate; the row says "Revoked by an administrator".
- A row can be opened to show its history (`certificate.history`): what happened, when, by whom, the reason and the note.

## Admin portal

### Certificates (`routes/certificates.tsx`, `-components/certificates-screen.tsx`, a "Certificates" entry in `navItems`)

- A field "Certificate ID" and **Look up**. Unknown or malformed: "Certificate not found".
- Found: the learner name, course title, dates, statement, status and history, and **Revoke** (reasons as above plus "Order refunded") or **Restore**, each with the same dialog rules.
