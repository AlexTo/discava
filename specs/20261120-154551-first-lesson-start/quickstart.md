# Quickstart: checking the first-lesson start

## Prerequisites

- Docker running, `pnpm i` done, `pnpm dev` running.
- A published free course with two or more shown lessons, and a priced one if payments are connected locally (the checkout spec's quickstart says how). `pnpm nx run @discava/e2e:seed-local-courses` makes courses, or publish one as Alice in the instructor portal.
- Local data from before the analytics change: rebuild the figures of the courses you look at, `pnpm nx run @discava/tooling-deploy:rebuild-analytics -- <courseId>`.

## Automated checks

```sh
pnpm nx run @discava/core-table:test -- --run first-lesson-prompt discussion analytics-contributions invariants
pnpm nx run @discava/core-api:test -- --run discussion.test.ts enrolment.test.ts course-view.test.ts router.test.ts
pnpm nx run @discava/instructor-api:test -- --run course.test.ts analytics.test.ts
pnpm nx run @discava/student-portal:test -- --run enrolment-actions start-course first-lesson-prompt
pnpm nx run @discava/instructor-portal:test -- --run course-first-lesson-prompt-form activation-card
pnpm nx e2e @discava/e2e -- --grep "lands in|first-lesson prompt|activation"
```

All pass. The e2e tests post their screenshots on the PR.

## By hand

Save screenshots of the key steps to `tmp/screenshots/pr-<number>/`.

**Landing (student portal, as Bob)**

1. Open a free course you are not enrolled in and press **Enrol now**. The first lesson opens, with "You're enrolled in <course>." and no dialog. Its first item is at the top; a video is loaded but not playing.
2. Press Back. You are on the course page, enrolled. Press Forward, then reload the lesson from the address bar in a new tab: no confirmation line.
3. As Alice, hide the course's first lesson. As Dan, enrol: the second lesson opens.
4. As Alice, publish a course with no lessons. As Dan, enrol: the course home opens, confirms the enrolment and says "No lessons yet".
5. Buy a priced course through the local payment page. Back on the course page you see "Confirming your payment", then the first lesson, without clicking. Press Back: you are not sent into the lesson again.
6. From My Learning, press **Continue** on a course with progress: it resumes at the same lesson as before this change.

**The prompt**

7. In the first lesson, the Questions section shows the prompt, with the note that everyone in the course can read the answer. Focus has not moved to it. The second lesson has no prompt.
8. Write an answer and press **Post**. It is at the top of the list, labelled "Answer to the course prompt", and the prompt is gone.
9. Sign in as the same learner in a private window: no prompt in the first lesson.
10. As Dan, press **Not now** in the same course. Reload: no prompt, and nothing was posted.
11. As Alice in the instructor portal, open the course's Questions: the answer is under By lesson, and not under Unanswered.

**The instructor's text**

12. As Alice, open the course's settings. The prompt form says it is using the default. Save "Which dataset do you want to analyse first?".
13. As a learner who has not closed the prompt (sign in as "Someone else" and enrol), the first lesson shows Alice's text. Bob and Dan still see no prompt.
14. Press **Use default**: the default is back for the next new learner.

**Activation**

15. As Alice, open the course's analytics. Activation shows the enrolments so far and how many have started, plus the prompt's answers and dismissals from steps 8 and 10.
16. As a learner who has done nothing yet, complete one item. Within a few seconds the activated count rises by one. Complete another: it does not rise again.
17. Switch the range between 30 and 90 days: the range line follows.

## On a deployed stage

After the analytics change is deployed, rebuild the existing courses' figures once (`RUNTIME_CONFIG_APP_ID` set and AWS credentials present, as CONTRIBUTING.md describes), then repeat steps 1, 5, 8, 9 and 15.
