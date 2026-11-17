# Quickstart: Validating Announcements

Prerequisites: the notifications spec's phases listed in the spec's "Dependency on the notifications spec" are merged (at least 1 and 2 to post, 5 for delivery, 3 and 8 to see the bell); Docker running; `pnpm i`; once, `pnpm --filter @discava/e2e exec playwright install chromium`.

## Automated

```sh
pnpm nx run-many --target test --projects=@discava/core-table,@discava/common-tiptap,@discava/core-api,@discava/instructor-api,@discava/common-shadcn,@discava/student-portal,@discava/instructor-portal
pnpm nx e2e @discava/e2e        # includes announcement.e2e.ts and the double-post race
pnpm build
```

The e2e scenario makes its own users and uniquely named data and ends with the core-table invariant check, which now includes `announcement-shape` and `announcement-has-broadcast`.

## By hand (local stack)

1. `pnpm dev`. Sign in as Alice (instructor) in the instructor portal; open one of her published courses with Bob and Dan enrolled (enrol them from the student portal if needed).
2. In "Announcements", write a title and a text with bold and a list, and press "Post announcement". It appears first in the list.
3. Sign in as Bob in the student portal. Within a minute (or on refocus) the bell shows 1 and lists "New announcement in <course>" with the excerpt. Select it: you land on the course home, with the announcement shown formatted. Dan has the same notification. Carol (admin, not enrolled) has none.
4. Edit the announcement as Alice. Bob's course home shows the new text and "edited" after a reload; Bob's bell has no new notification.
5. Delete it as Alice (the dialog mentions the notification students keep). Bob's course home no longer lists it; his bell notification remains and still opens the course home.
6. As Bob, request another course's announcements (open its course home, or call the API): refused. Drop Bob's enrolment and check his course home refuses too.
7. `http://localhost:2024/inbox` (when the notifications email phases are in) shows the announcement email for Bob.
8. Archive the course: the instructor's section lists, edits and deletes, and shows the "can't have new announcements" note instead of the form.

Save key screenshots under `tmp/screenshots/pr-<number>/` (task list's human tasks).

## Deployed stage (human)

After the notifications spec's deployed check passes: post one announcement in a real course on `discava-development`, confirm each enrolled test student gets the bell notification and the email once, and that a dropped student gets neither.
