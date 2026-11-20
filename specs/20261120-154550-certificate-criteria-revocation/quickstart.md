# Quickstart: Validating Certificate Criteria, the Statement and Revocation

Prerequisites: Docker running; `pnpm i`; once, `pnpm --filter @discava/e2e exec playwright install chromium`. Details of each interface are in [contracts/](./contracts/); the data rules are in [data-model.md](./data-model.md).

## Automated

```sh
pnpm nx run-many --target test --projects=@discava/core-table,@discava/events,@discava/core-api,@discava/instructor-api,@discava/admin-api,@discava/student-portal,@discava/instructor-portal,@discava/admin-portal
pnpm nx e2e @discava/e2e        # certificate-criteria.e2e.ts, certificate-revocation.e2e.ts, concurrency/certificate-revoke.e2e.ts
pnpm build
```

## By hand (local stack, `pnpm dev`)

Sign-in users: Alice (instructor and student), Bob and Dan (students), Carol (admin).

### Criteria and the learner's view (after Phase 3)

1. As Alice, publish a course with one text lesson, one quiz with a 70% pass mark and 1 attempt, and a stated length of 12 hours. In its settings, tick "Require passing every quiz".
2. As Bob, enrol, mark the text as done and fail the quiz. The course shows as completed. The course home's Certificate panel shows "Pass every quiz: 0 of 1" and "Not passed, no attempts left". My Learning shows no certificate.
3. As Alice, raise the quiz's attempts to 2. As Bob, pass it. Within seconds the panel shows the certificate.
4. As Dan, enrol, mark the text as done and fail the quiz. As Alice, untick the criterion: Dan's certificate appears within seconds. Tick it again: Bob's and Dan's certificates are unchanged.

### What was assessed (after Phase 4)

5. Open Bob's verification link signed out: "Completed all 2 items of the course.", "Passed 1 assessed quiz. Pass mark: 70%.", an overall score band and "Course length: 12 hours." Dan's says "No graded assessment was required for this certificate." and shows no score.
6. Download both PDFs: the same lines.
7. As Alice, change the quiz's pass mark and the course length. Reload both pages: nothing changed.

### Revocation (after Phase 6)

8. As Alice, open the course's Certificates section, revoke Bob's with "Academic integrity".
9. Signed out, open Bob's link: "Certificate revoked", the ID and the date, and no name or course.
10. As Bob: My Learning and the course home say the certificate was revoked and offer no actions; a notification and an email (inbox at `http://localhost:2024/inbox`) say so with the reason category. Calling Download PDF from an old tab is refused.
11. As Alice, restore it: Bob's link verifies again with the same ID.
12. As Carol, open Certificates in the admin portal, look up Dan's ID, revoke with "Order refunded". As Alice, the row says "Revoked by an administrator" and offers no Restore. As Carol, restore it.

### Graded uploads (after Phase 8, needs #102 part 3)

13. Add an upload assignment worth 10 points; tick "Require graded assignments to be returned with at least" 60. As a new student, complete everything and submit: no certificate, "Waiting to be graded". Return with 4 points and reopen: "Returned with 40%; 60% needed". Resubmit, return with 8: the certificate arrives and counts one more assessed item.

Save screenshots of the key steps to `tmp/screenshots/pr-<number>/`.

## Expected data afterwards

- One `certificate` each for Bob and Dan, both valid, each with an `assessment`; Bob's lists one assessed quiz, Dan's none.
- Two `certificateEvent` records for each of them (revoked, restored).
- The course's `certificateCriteria.version` is 4 after step 4 and higher after step 13.
- Core-table invariants pass.
