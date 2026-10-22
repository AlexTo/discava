# @discava/e2e

End-to-end tests for Discava (#3). [Playwright](https://playwright.dev) drives the portals in Chromium against the whole local stack from `pnpm dev`: the portals, both APIs and the event runner, with DynamoDB local, S3Mock and the local OIDC server standing in for AWS. Nothing calls AWS.

They check what unit tests can't, because unit tests mock the table and the other services:
- a portal and an API working together;
- one API's writes reaching another;
- background work like progress recalculation;
- the sign-in flow.

## Running them

You need Docker running and Playwright's Chromium installed once:

```sh
pnpm --filter @discava/e2e exec playwright install chromium
```

Then:

```sh
pnpm nx e2e @discava/e2e                     # headless, reusing a running `pnpm dev`, or starting one
pnpm nx e2e @discava/e2e --configuration=ui  # Playwright's UI mode, for writing and debugging tests
pnpm nx e2e @discava/e2e -- learn            # only the scenarios whose file matches "learn"
```

If `pnpm dev` is already running, the tests use it. Otherwise Playwright starts it, waits for every service to answer (see `src/global-setup.ts`), and stops it, and its containers, afterwards. In CI it always starts a fresh one.

When a test fails, its trace, screenshots and video are kept in `dist/packages/e2e/test-results/`. Open a trace with `pnpm --filter @discava/e2e exec playwright show-trace <path>/trace.zip`. In CI they're uploaded as the `e2e-results` artifact.

## Writing a scenario

One file per user-facing flow, in `src/scenarios/`, named `*.e2e.ts`. Build it from the helpers in `src/helpers/`:

- `users.ts`: `signIn`; `newUser` for a fresh user through the local OIDC page's "Someone else" form; `testUser` for Alice, Bob, Dan or Carol; `uniqueName` for course titles and the like.
- `instructor-portal.ts`:
  - building: `createCourse`, `addModule`, `addLesson`, `addTextItem`, `addVideoItem`, `addQuiz`;
  - checking and publishing: `expectVideoPreviewToPlay`, `publishCourse`.
- `student-portal.ts`:
  - getting in: `openCourse`, `enrol`, `startFirstLesson`;
  - in a lesson: `lessonItem`, `lessonVideo`, `markItemDone`, `takeQuiz`;
  - the result: `expectCourseCompleted`.
- `video.ts`: `expectToPlay`, which checks a `<video>` really plays, and `THREE_SECOND_VIDEO`, the test video.
- `portals.ts`: where everything runs.

Fixtures go in `src/files/`. `three-seconds.mp4` is a 39 KB, 3-second H.264/AAC clip of colour bars with a moving counter, made with ffmpeg (the command is in `src/helpers/video.ts`). Keep fixtures synthetic and small, never real course material.

Add a helper when a step will be reused, and keep each one waiting for what it did to show, so the next step starts from a settled page. Find elements by role and accessible name, as a user would (`getByRole('button', { name: 'Publish' })`), rather than by CSS. If something has no accessible name, that's worth fixing in the portal too.

## Data

The tests run against whatever local data there is, and never reset it:

- **Anything that writes** uses a new user and unique names, so scenarios don't see each other's data or yours, and can run again without cleaning up.
- **The fixed test users** (Alice, Bob, Dan, Carol) are shared with whoever uses the local stack, so scenarios only read as them.

Locally, each run leaves its users and courses behind. `pnpm nx run @discava/common-scripts:reset-local-data` clears everything (stop `pnpm dev` first).

## Background work

Some results arrive a few seconds after the action that caused them. For example, course progress comes from the core table's stream, through the event runner's progress recalculation. Wait for the result itself, with a timeout long enough for the background work (see `expectCourseCompleted`), rather than sleeping for a fixed time. Don't reload to make it appear: the portals are meant to pick it up by themselves, and the test should fail if they stop.
