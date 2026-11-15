# Quickstart: Validating Instructor Dashboard and Course Analytics

An agent runs the unit, component, lint, typecheck, `build` and `synth` checks. The e2e scenarios run on PR CI. The manual walkthrough needs a running stack and is a `(human)` task.

## Automated

```sh
pnpm nx run @discava/core-table:test              # contributions, rebuild, markers, invariant and its breaking test
pnpm nx run @discava/events:test                  # analytics handler: replay, retry, ordering
pnpm nx run @discava/instructor-api:test          # analytics router, authorization
pnpm nx run @discava/instructor-portal:test       # dashboard and course analytics pages
pnpm nx run @discava/infra:test                   # third stream mapping, TTL on the table
pnpm nx run-many --target build --projects @discava/infra,@discava/events
pnpm nx e2e @discava/e2e                          # PR CI: analytics scenario, consistency after every test
```

## Manual walkthrough (human, `pnpm dev`)

1. Sign in as Alice (instructor) in the instructor portal and open the dashboard: no placeholder text; one card per course.
2. In the student portal, sign in as Bob, enrol in one of Alice's published courses, complete a lesson, and take a quiz with a wrong answer.
3. Back in the dashboard, within about 30 seconds, reload: Bob counts as an enrolment and as active this week.
4. Open the course: today's bars show one enrolment and one active learner, the lesson shows one completed, the quiz shows the question miss and Bob's score band.
5. Hide a lesson in the course editor and reload: it leaves the drop-off list. Show it again: its figures return.
6. Sign in as someone who teaches no course through "Someone else" with the `instructor` group, and request Alice's course analytics URL: not found.
7. Save screenshots of each step to `tmp/screenshots/pr-<number>/` (constitution VIII).

## Rebuild check

```sh
pnpm nx run @discava/common-scripts:rebuild-analytics -- <courseId>
```

Compare the course's figures before and after: they must be equal.

## Contracts and model

- [contracts/instructor-api-analytics.md](./contracts/instructor-api-analytics.md)
- [contracts/instructor-portal-ui.md](./contracts/instructor-portal-ui.md)
- [data-model.md](./data-model.md)
