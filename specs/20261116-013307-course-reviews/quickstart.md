# Quickstart: Validating Ratings and Reviews

Prerequisites: Docker running; `pnpm i`; once, `pnpm --filter @discava/e2e exec playwright install chromium`.

## Automated

```sh
pnpm nx run-many --target test --projects=@discava/core-table,@discava/core-api,@discava/instructor-api,@discava/admin-api,@discava/events,@discava/search,@discava/student-portal,@discava/instructor-portal,@discava/admin-portal
pnpm nx e2e @discava/e2e        # includes review.e2e.ts and the concurrent review writes
pnpm build
```

## By hand (local stack)

1. `pnpm dev`; sign in as Alice (instructor) and publish a course with one text lesson.
2. As Bob (student), enrol, open the course page, post 4 stars with a sentence. The summary reads 4.0 (1 rating) and the review shows "Bob ...". Edit it to 5 stars: still 1 rating, 5.0, marked edited. Open a second tab and submit twice at once: one review.
3. As Dan (not enrolled): the page says to enrol; posting is refused.
4. As Alice, open the course's Reviews screen, respond to Bob's review; the response shows on the course page for a signed-out visitor.
5. Wait a few seconds, then search for the course's title with Sort set to Highest rated and Minimum rating 4.5 and up: the course appears with its rating; with a worse-rated course present it ranks below.
6. As Carol (admin), open Reviews, pick the course, remove Bob's review with a reason. The course page, card and search show no rating. As Bob, the page shows the removed notice and no form.
7. Save screenshots of the key steps to `tmp/screenshots/pr-<number>/`.

## Expected data afterwards

- One `review` for Bob with `status: removed`; `courseRating` with all zeros.
- Core-table invariants pass.
