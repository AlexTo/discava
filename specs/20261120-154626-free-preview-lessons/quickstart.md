# Quickstart: checking free preview lessons

## Prerequisites

- Docker running, `pnpm i` done, `pnpm dev` running.
- Stripe connected locally if you want a priced course: sign in to the admin portal as Carol and save `sk_test_local` on the Payments page (checkout spec quickstart, step 0).

## Automated checks

```sh
pnpm nx run @discava/core-table:test -- --run curriculum invariants stream-features
pnpm nx run @discava/common-server-utils:test -- --run lesson-media
pnpm nx run @discava/instructor-api:test -- --run lesson.test.ts
pnpm nx run @discava/core-api:test -- --run free-preview paid-access course.test.ts router.test.ts render handler
pnpm nx run @discava/common-constructs:test -- --run core-api.test.ts
pnpm nx run @discava/student-portal:test -- --run free-preview course-page enrolment-actions
pnpm nx run @discava/instructor-portal:test -- --run free-preview
pnpm nx e2e @discava/e2e -- free-preview
```

All pass. The e2e scenario posts its screenshots on the PR.

## By hand (local stack)

Save screenshots of the key steps to `tmp/screenshots/pr-<number>/`.

### Mark a lesson (Alice, instructor portal)

1. Create a course with two ordinary lessons and one assignment lesson. Put a video, a text, a file and a quiz in the first lesson. Give the course a price and publish it.
2. On the first lesson choose **Make free preview**. The confirmation says anyone will be able to open it. Confirm: the lesson shows "Free preview".
3. The assignment lesson offers no such control.
4. Hide the first lesson: the badge reads "Free preview (not public yet)". Publish it again.

### Watch it (a private window, signed out, student portal)

5. Open the course's landing page. The first lesson is a link with "Free preview"; the second is plain text.
6. Follow the link. The lesson's title, text and file show; the quiz is a locked card with its question count; there is no "Mark as done" and no discussion.
7. Press **Play**. The video plays with captions and speed control. Before pressing, the network panel shows no `freePreview.videoUrl` request.
8. Press **Download**: the file downloads under its own name.
9. The page offers **Sign in to buy** with the price and says progress is saved once you enrol.

### Try to get more (the same private window)

10. Change the address's lesson to the second lesson's ID: "This preview is no longer available."
11. In the console, call `freePreview.videoUrl` with the first lesson's IDs and a video item of the second lesson; then `contentItem.videoUrl` for the first lesson's video. The first is `NOT_FOUND`, the second `UNAUTHORIZED` (signed out) or `FORBIDDEN` (signed in as Dan, not enrolled).
12. Sign in as Dan (not enrolled) and open the preview: the same page as signed out.

### Unmark (Alice), then the visitor again

13. Choose **Remove free preview** on the first lesson.
14. In the private window reload the preview address: "This preview is no longer available", with a link to the course. Reload the landing page: the label is gone (locally nothing caches it; on a deployed stage the edge may keep the page for up to five minutes).
15. Mark it again, then archive the course: the preview address says "no longer available" with no link.

### Enrol from a preview

16. On a free published course with a marked lesson, open the preview as Dan, choose **Enrol now**, then **Start this lesson**: the normal lesson page opens with no progress.
17. Open the preview address again as Dan: it goes straight to the lesson page.

### Crawler content

18. `curl -s http://localhost:2026/learn/<courseId>` contains the first lesson's title inside a link to `/learn/<courseId>/preview/<lessonId>` followed by "Free preview".
19. `curl -s http://localhost:2026/learn/<courseId>/preview/<lessonId>` contains `noindex` and none of the lesson's text.

### Nothing was recorded

20. Run `pnpm nx e2e @discava/e2e -- free-preview`: its table invariant check after each test passes, which includes that no student record exists for a course the student only previewed (`student-records-enrolled`).

## On a deployed stage (signing only runs there)

After deploying to `discava-development`, with a published course that has one marked and one unmarked video lesson:

1. Signed out, play the preview video. In the browser's cookie list the three CloudFront cookies have a `Path` equal to that video version's folder and expire in one hour.
2. With those cookies, request the unmarked lesson's `master.m3u8` on the media domain (its address is visible to an enrolled student): CloudFront answers 403.
3. Leave the preview playing for over 30 minutes: a second `freePreview.videoUrl` request appears and playback continues.
4. Unmark the lesson while the video plays: it keeps playing for at most an hour; a reload shows "no longer available"; a new `freePreview.videoUrl` request is `NOT_FOUND`.
5. From a page on another origin, try to play the preview's manifest address in a video element: it does not play.
6. Fire 20 `freePreview.lesson` requests in a second: some get 429, and the landing page still loads.
