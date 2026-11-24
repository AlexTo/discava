# Quickstart: Validating Q&A and Discussion Threads

Prerequisites: Docker running; `pnpm i`; once, `pnpm --filter @discava/e2e exec playwright install chromium`.

## Automated

```sh
pnpm nx run-many --target test --projects=@discava/core-table,@discava/core-api,@discava/instructor-api,@discava/common-web-utils,@discava/common-shadcn,@discava/student-portal,@discava/instructor-portal
pnpm nx e2e @discava/e2e        # includes discussion.e2e.ts and the counter race
pnpm build
```

## By hand (local stack)

1. `pnpm dev`; sign in as Alice (instructor) and publish a course with one lesson. Enrol Bob and Dan (students) and leave a third student, Eve (from the "Someone else" form), not enrolled.
2. As Bob, open the lesson, ask a question with a title and details. It appears first with Bob's name. Reload; it stays.
3. As Dan, reply, then upvote Bob's question and reply. Bob cannot upvote his own question. As Eve, open the lesson URL: refused.
4. As Alice, open the thread from the instructor portal's Questions area (By lesson) and reply: the reply carries an Instructor badge although Alice is not enrolled. As Bob, mark Dan's reply as the answer: it moves to the top as "Accepted answer".
5. In the instructor portal's Questions area: with Bob's second question unanswered, check it is in Unanswered; reply to it as Alice and check it leaves the list.
6. As Dan, report one of Bob's replies. As Alice, open Reported: it shows "1 report". Hide it: as Bob it shows "This post was hidden by an instructor."; unhide it; delete it: it shows "This post was deleted." for everyone.
7. As Alice, archive the lesson: Bob can no longer open it, Alice still reads its questions under By lesson (read-only); restore the lesson and check every thread is intact. Try deleting the archived lesson permanently: refused because it has questions.
8. With the notifications pipeline merged: Bob's bell shows Dan's reply; accepting a reply notifies its author and, when Alice accepts, Bob. Replying to one's own question notifies nobody.
9. Save screenshots of the key steps to `tmp/screenshots/pr-<number>/`.

## Expected data afterwards

- Question and reply records with counts matching their replies and votes; a tombstoned deleted post with no text; no question flagged unanswered that has an instructor reply or accepted answer.
- Core-table invariants pass.
