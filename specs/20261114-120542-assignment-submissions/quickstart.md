# Quickstart: Validating Student Submissions

Prerequisites: Docker running; `pnpm i`; once, `pnpm --filter @discava/e2e exec playwright install chromium`.

## Automated

```sh
pnpm nx run-many --target test --projects=@discava/core-table,@discava/core-api,@discava/instructor-api,@discava/common-server-utils,@discava/student-portal
pnpm nx e2e @discava/e2e        # includes assignment.e2e.ts and the resubmit race
pnpm build                       # synth, checkov and the stack resource count
```

The e2e scenario makes its own users and uniquely named data and ends with the core-table invariant check.

## By hand (local stack)

1. `pnpm dev`, then sign in as Alice (instructor, student) in the instructor portal.
2. Create a published course with a module and an upload assignment (instructions, a due date a minute in the future, max points); publish it.
3. Sign in as Bob in the student portal, enrol, and open the course. Expect: the outline shows an assignment icon, an "Assignment" label and the due date; opening it lands on the submit form.
4. Attach a PDF, submit. Expect: confirmation, the item marked done, the file listed with a download that works.
5. Wait past the due date, resubmit with a different file. Expect: a "late" notice, version 2, and the download returns the new file.
6. Try a 101 MB file and a `.exe`. Expect: a clear refusal each time and nothing changed.
7. As Dan (not enrolled), call the assignment procedures. Expect: refused.
8. Hide the assignment as Alice. Expect: Bob can't see his submission; show it again and it returns.
9. Save screenshots of the key steps to `tmp/screenshots/pr-<number>/` (git-ignored), including any failure.

## Expected data afterwards

- One `assignmentSubmission` for Bob, `version: 2`, `late: true`, with its `file` under `…/submissions/<bob>/<attemptId>/`.
- `studentActivityCount` is 1 on the item.
- After the retirement delay (local runner: a few seconds), the first submission's folder is gone: only one folder remains under `…/submissions/<bob>/`.

See [contracts/core-api-assignment.md](./contracts/core-api-assignment.md) and [data-model.md](./data-model.md).
