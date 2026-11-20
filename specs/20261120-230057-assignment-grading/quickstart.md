# Quickstart: Grading and Feedback for Upload Assignments

How to check the feature works. Contracts: [instructor-api](./contracts/instructor-api-assignment-submission.md), [core-api](./contracts/core-api-assignment.md), [screens](./contracts/portal-ui.md). Data: [data-model.md](./data-model.md).

## Automated (agents and CI)

```sh
pnpm nx run @discava/core-table:test -- --run assignment-grading
pnpm nx run @discava/core-table:test -- --run invariants
pnpm nx run @discava/instructor-api:test -- --run assignment-submission grading-queue
pnpm nx run @discava/core-api:test -- --run assignment
pnpm nx run @discava/instructor-portal:test -- --run submissions grading-draft
pnpm nx run @discava/student-portal:test -- --run assignment-item
pnpm nx run @discava/tooling-agent:entity-writers   # then commit core-table/entity-writers.json
pnpm nx affected --target build
```

CI also runs the e2e scenario `packages/e2e/src/scenarios/assignment-grading.e2e.ts` and the concurrency tests in `packages/e2e/src/concurrency/`.

## By hand, locally (reviewer)

Prerequisites: Docker running, `pnpm dev`. Sign in as Carol (instructor) in the instructor portal and Alice and Bob (students) in the student portal. Users are listed in CONTRIBUTING.md.

1. **Set up.** As Carol, create a course with one module and an upload assignment, "Essay 1", out of 20 points, then publish it. Enrol Alice and Bob.
2. **Submit.** As Alice, submit a PDF. As Bob, submit a .docx.
   - Expected: Carol has one "New submissions to Essay 1" notification, not two.
3. **List.** As Carol, open the course, then "Submissions" on Essay 1.
   - Expected: Alice and Bob are waiting, oldest first, each with a time waited.
4. **Review a PDF.** Open Alice.
   - Expected: the PDF's pages render in the page; Download works.
5. **Request resubmission.** Type feedback, reload the page (the feedback is still there), then press "Request resubmission".
   - Expected: Alice gets a notification (and an email in the local mail log). On her assignment she sees the feedback and an open resubmit form.
6. **Resubmit.** As Alice, resubmit.
   - Expected: she is waiting again at version 2, and the earlier feedback is still listed for Carol and Alice.
7. **Return.** As Carol, return Alice's work with 17 points and feedback.
   - Expected: Alice is notified and sees 17 / 20 and the feedback, and the resubmit form is gone.
8. **Amend.** As Carol, choose "Edit grade" and change it to 18.
   - Expected: Alice gets a "grade updated" notification and sees 18 / 20; Carol's history lists both values.
9. **No preview.** Open Bob.
   - Expected: no preview, the file's details and Download.
10. **Points out of range.** Try returning Bob's work with 25 points.
    - Expected: refused, "out of 20".
11. **Race.** Open Bob's review page in two tabs as Carol and return from both.
    - Expected: one succeeds, the other shows "Another instructor already returned this".
12. **Grading queue** (Story 5).
    - Expected: Carol's home page shows "Waiting for grading" with the right count, and each entry opens its review page.

Save screenshots of each step to `tmp/screenshots/pr-<number>/`.
