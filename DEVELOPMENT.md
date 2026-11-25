# Development Guide

How Discava is built, run and changed. It is written for maintainers and the agents in the [development pipeline](https://github.com/AlexTo/agentic-sdlc); Discava doesn't accept outside pull requests (see [CONTRIBUTING.md](CONTRIBUTING.md)), but you're welcome to follow it on your own fork.

## How Changes Are Made

Every change, whoever or whatever makes it:

1. Starts from the latest source on the `main` branch, after checking open and recently merged pull requests to make sure the work isn't done already.
2. Stays focused on the specific change; reformatting unrelated code makes it hard to review.
3. Runs the full build locally before pushing: `pnpm build` (this chains lint, compile, test, and bundle/synth/checkov per project). For a faster loop while iterating, target one project, or run `pnpm nx affected --target <lint|test|build>` to only touch what your change affects, the same way CI's PR checks do.
4. Is committed with `git commit` as usual; the `prepare-commit-msg` hook runs [Commitizen](https://commitizen.github.io/cz-cli/) to build a [Conventional Commits](https://www.conventionalcommits.org) message interactively, and `commitlint` enforces it on `commit-msg`. PR titles follow the same convention.
5. Lands through a pull request that passes CI: `pr-checks.yml` runs lint/test/build against the changes, and the author stays with it until every check passes.

## Running Discava Locally

Local dev needs **Docker** running, and no AWS account or deployed stage:

```sh
pnpm i
pnpm dev
```

`pnpm dev` starts the APIs, the three portals, and local stand-ins for the AWS services they use:

| Service | Port | Stands in for |
| --- | --- | --- |
| Student / instructor / admin portal | 4201 / 4200 / 4202 | CloudFront |
| core-api / instructor-api / admin-api | 2022 / 2023 / 2025 | API Gateway and Lambda |
| Page renderer | 2026 | The core-api Lambda behind the student portal's CloudFront distribution that serves public pages as HTML (course landing pages, instructor profiles, certificate pages, site map, robots) |
| DynamoDB local | 8001 | DynamoDB |
| S3Mock | 9090 | S3 (uploads, lesson media, course images) |
| ElasticMQ | 9324 | SQS (the stream router's queues and failure queues) |
| OpenSearch | 9200 | OpenSearch (the course search and transcript search indices; started by `packages/databases/search`'s `dev` target, which also syncs the local indices) |
| Event runner | 2024 | Everything event-driven; see the list below |
| Local OIDC server | 9400 | Cognito |

The event runner (`packages/events/src/local`) stands in for:

- **The table's stream and its consumers**: the stream router and each feature's queue, such as notification delivery.
- **MediaConvert**: ffmpeg in Docker.
- **Amazon Transcribe**: writes a placeholder caption track.
- **Amazon Translate**: prefixes each caption with its target language.
- **SES**: sent emails are kept in `tmp/local-dev/emails/`, with an inbox at `http://localhost:2024/inbox`.
- **EventBridge and Scheduler**.
- **Cognito's pre token generation trigger**, which keeps user records in step.
- **Stripe**: its API, hosted checkout page and signed webhook deliveries to `/stripe/webhook`. The saved key lives in `tmp/local-dev/secrets/`.

**Signing in.** The portals send you to a local sign-in page: pick **Alice** (instructor and student), **Bob** (student), **Dan** (a second student, e.g. one who isn't enrolled) or **Carol** (admin). There are no passwords. Under "Someone else" you can sign in with any claims, such as other groups. Cognito itself (Managed Login, sign-up, the post-confirmation trigger) is tested on the deployed `discava-development` stage.

**Lesson videos** transcode on your machine with ffmpeg: a few minutes for a long lecture. `LOCAL_TRANSCODE_RENDITIONS=360p pnpm dev` makes only the 360p rendition, for speed. Jobs work in the git-ignored `tmp/local-dev/transcode/`, and a failed job keeps its files and an `error.log` there. Each finished video also gets a placeholder caption track, written by the local Transcribe stand-in and handled by the same completion code as the real event, so the captions menu can be tried without Transcribe. Caption translation is a stand-in too: it prefixes each caption with the target language (`[es-ES] …`), and a caption containing `[[fail-translation]]` or `[[fail-translation:es-ES]]` makes that language fail. Course progress updates a few seconds after a change, as when deployed.

**Sample data.** With `pnpm dev` running, `pnpm nx run @discava/e2e:seed-local-courses` publishes a few courses as Alice, with categories, tags and levels, and `pnpm nx run @discava/tooling-deploy:seed-categories` adds the starting categories (Science, Technology, Mathematics, Communication, Business), skipping any that exist.

**Notifications.** `pnpm nx run @discava/tooling-local-dev:notify-local -- --user <sub> --type <id> [--param k=v]... [--key <dedupeKey>]` publishes a notification to a local user (`--course <courseId>` notifies every student enrolled in a course), with canned params for the type; the email it sends shows up in the inbox above.

**Course analytics.** The instructor dashboard's figures are kept up to date from the table's stream. `pnpm nx run @discava/tooling-deploy:rebuild-analytics -- <courseId> [<courseId> ...]` recomputes a course's figures from its records, to repair drift or backfill a course; it runs against local data, or against a deployed table when `DISCAVA_DYNAMODB_CORE_TABLE` is set (`{"tableName":"<table>"}`, the `CoreTableName` output of `<stage>-Data`) and AWS credentials are present.

**Search indices.** On a deployed stage, `pnpm nx run @discava/tooling-deploy:reindex-search --stage=<stage>` re-indexes every published course, and `pnpm nx run @discava/tooling-deploy:reindex-transcripts --stage=<stage> [--course=<courseId>]` rebuilds the transcripts index, for one course or all of them. With no `--stage`, `reindex-transcripts` runs against the local stack.

**Payments.** No Stripe account is needed. As Carol, open Payments in the admin portal and connect the key `sk_test_local`; Alice can then price a course and Bob can buy it on the stand-in's payment page (Pay, Decline card, Cancel). `POST http://localhost:2024/stripe/test/refund`, `/replay` and `/expire` do what the Stripe dashboard or a redelivery would, and `POST http://localhost:2024/payout-run` runs the daily payout run once. The docs' [Payments](./docs/src/content/docs/en/design/payments.mdx) and [Instructor payouts](./docs/src/content/docs/en/design/instructor-payouts.mdx) design pages describe both.

**Starting fresh.** Local data lives in Docker volumes and survives restarts. To delete it all, stop `pnpm dev`, then run the command below. It also deletes `tmp/local-dev/`, which includes the Stripe key an administrator connected (`secrets/`), since the connection record it belongs to is in the table being wiped:

```sh
pnpm nx run @discava/tooling-local-dev:reset-local-data
```

**What only runs on dev:** CloudFront signing and cookies, MediaConvert's exact encoding and its extra audio output, real Transcribe output and the Transcribe completion event, real Amazon Translate output (its line-break behaviour and throttling) and the `CaptionTranslation` metrics, caption access through CloudFront cookies, Cognito Managed Login and sign-up, EventBridge and stream retries, the failure queues, the stuck-video reconciler, and Stripe itself (its hosted checkout page, 3-D Secure, real webhook deliveries and Connect onboarding, checked with a test-mode key). Check changes to those after deploying.

## Adding a New Project or Component

Prefer the [Nx Plugin for AWS](https://awslabs.github.io/nx-plugin-for-aws) generators over hand-scaffolding. That's how every existing package in this repo (`core-api`, `core-table`, the portals, `infra`) was created, and it keeps generated projects consistent and eligible for future `nx migrate` upgrades. If you have the `nx-plugin-for-aws` MCP server available, use `list-generators` / `generator-guide` to find the right one; otherwise check the [generator docs](https://awslabs.github.io/nx-plugin-for-aws/en/guides/).

## Code Style and License Headers

[Biome](https://biomejs.dev) formats and lints this codebase (single quotes, trailing commas, 80-column width); `pnpm lint` runs it with `--configuration=fix`. Every source file, except generated output, translated docs, and `.astro` files, carries an Apache-2.0 SPDX header, written by the `license#sync` Nx sync generator (configured in [aws-nx-plugin.config.mts](aws-nx-plugin.config.mts)). Please don't hand-edit headers; `pnpm lint` and `pnpm build` keep them in sync for you.

## UI Changes

Before opening a pull request that changes what a user sees in a portal or in `packages/common/shadcn`, check it against the UI rules in [`packages/websites/CLAUDE.md`](packages/websites/CLAUDE.md).

## Rules That Span Records

Every API and event handler shares the core table, and some rules span records that different writers touch. For example, core-api counts the students who have used an item (`studentActivityCount`), and instructor-api relies on that count to refuse deleting the item. A write that keeps a rule another API or handler depends on goes in a `core-table` helper, for example `studentActivityWrites` in `helpers/student-activity.ts`, and every procedure making that write calls the helper. Don't write it by hand in each procedure. A rule that only one API keeps can stay in that API.

Add a check for each such rule to `core-table`'s `helpers/invariants/` folder. The e2e suite runs those checks after every scenario (see [End-to-End Tests](#end-to-end-tests)).

The folder has one file per topic (`curriculum.ts`, `student-activity.ts`, `media.ts`, `analytics.ts`, `certificates.ts`, `assignment-grading.ts`, `payments.ts`, `coupons.ts`, `earnings.ts`, `notifications.ts`, `catalogue.ts`, `discussion.ts`, `reviews.ts`…), each exporting its checks as `[{ name, check }]`, and a `<topic>.test.ts` beside it. To add a check:

1. Write `check<Name>(snapshot)` in the topic's file (or a new topic file) and add `{ name: '<invariant-name>', check }` to that file's list. A new topic file's list goes into `CHECKS` in `index.ts`, which derives `INVARIANTS` from the names.
2. If it reads records of a new entity, add the entity to `TableSnapshot` and to `SNAPSHOT_ENTITIES` in `snapshot.ts`; that map drives `loadTableSnapshot` and `emptyTableSnapshot()`.
3. Add a `describe('<invariant-name>')` to the topic's `<topic>.test.ts`, starting from `consistentTable()` in `test-fixture.ts`, which also holds the `checkTableInvariants` wrapper the tests use.

Two checks make sure a change that could need a new rule gets one:

- **Every entity is in the snapshot.** A test in `core-table` (`helpers/invariants-coverage.test.ts`) fails when an entity's records aren't loaded into `TableSnapshot`. Add the new entity to `helpers/invariants/snapshot.ts`, with checks for the rules it keeps, or list it in that test's `NO_INVARIANTS` with the reason it has none.
- **Who writes each entity.** `core-table`'s `entity-writers.json` lists, for every entity, the files in each package that write it. It's generated from the code with the TypeScript compiler, so after changing which code writes the core table, regenerate it and commit the result:

  ```sh
  pnpm nx run @discava/tooling-agent:entity-writers
  ```

  A `pre-push` hook does this for you when the branch changes code under `packages/apis`, `packages/events`, `packages/databases` or `packages/tooling`: it regenerates the file and stops the push if it changed, so you can commit it and push again. The `Invariant coverage` PR check fails while the file is out of date. It also fails when, compared with `main`, an entity gains a writing package beside the ones it had, a file outside `core-table` starts writing an entity that several packages write, or a new entity appears, unless the lines the pull request adds under `helpers/invariants/` (not its tests) name that entity or its `TableSnapshot` key (`snapshot.enrolments`, say). If no rule spanning the writers is at stake, a maintainer adds the `no-new-invariant` label and re-runs the job. Run `pnpm nx run @discava/tooling-agent:invariant-coverage` to try the check locally against `origin/main`.

## Testing Portal Components

The portals' components are tested with [Vitest](https://vitest.dev) and [Testing Library](https://testing-library.com/docs/react-testing-library/intro), in jsdom. Put a test next to the component as `<name>.test.tsx`.

Render it with the portal's helper in `src/test/`, such as the instructor portal's `renderWithInstructorApi` from `src/test/render-with-instructor-api.tsx` (the admin portal has `renderWithAdminApi`). It wraps the component in a fresh React Query client and the real tRPC client, answered by handlers you give per procedure instead of the network:

```tsx
const { calls, user } = renderWithInstructorApi(<MyComponent courseId="course-1" />, {
  handlers: {
    'course.publish': () => ({ courseId: 'course-1', status: 'published' }),
    'course.restore': () => {
      throw new ApiError('PRECONDITION_FAILED', 'Restore the course first');
    },
  },
});

await user.click(screen.getByRole('button', { name: 'Publish' }));
await waitFor(() =>
  expect(calls).toEqual([{ path: 'course.publish', input: { courseId: 'course-1' } }]),
);
```

- `calls` lists every procedure the component called, with its input. A procedure without a handler fails with `NOT_FOUND`.
- Throw `ApiError(code, message)` from a handler to make the call fail the way the API does (`error.data.code` is set).
- Find elements by role and accessible name, as a user or screen reader would, rather than by class or test id.
- jsdom has no layout, so drag and drop can't be driven by the pointer or keyboard in these tests. Simulate the drop event instead (see `lesson-content-items-row.test.tsx`), and check real dragging in a browser.
- A component that reads only from core-api (every student portal page, and settings pages in the other portals) uses `renderWithCoreApi` from `src/test/render-with-core-api.tsx` the same way. A page that calls both core-api and its own portal's API, such as the instructor portal's home page and My Courses, wraps both providers in its test; see `_authenticated/-index.test.tsx`. The helpers are built by `createRenderWithApi` from `@discava/common-web-utils/testing`, which also holds the fake tRPC `fetch` (`fakeTrpcFetch`), the jsdom stubs (`installJsdomStubs`, called from each `src/test/setup.ts`) and `mockRouter`.
- A `route.tsx`'s component isn't exported directly; render `Route.options.component` from it. Name the test file `-route.test.tsx` (the `-` prefix), or TanStack Router's file-based routing picks it up as a route of its own.

## End-to-End Tests

`packages/e2e` drives the portals in Chromium with [Playwright](https://playwright.dev), against the whole local stack from `pnpm dev`. PR checks run it whenever the portals, APIs or event handlers change. To run it yourself, with Docker running (it reuses a running `pnpm dev`, or starts one):

```sh
pnpm --filter @discava/e2e exec playwright install chromium   # once
pnpm nx e2e @discava/e2e
```

A change to a main user flow should come with an end-to-end scenario, or an extended one. The flows are signing in, building and publishing a course, enrolling or buying, and learning. See [`packages/e2e/README.md`](./packages/e2e/README.md) for the helpers and the rules on test data.

## Writing Documentation

Docs live in `docs/` (Astro + Starlight, deployed to GitHub Pages). Please only author English content, under `docs/src/content/docs/en/`; other locales are generated from it, not hand-written.

To preview the site while you write (it prints the local address):

```sh
pnpm nx start @discava/docs
```

To translate your changes locally, with AWS credentials configured for Bedrock access:

```sh
pnpm nx run @discava/docs:translate            # translate files changed vs main
pnpm nx run @discava/docs:translate -- --all   # translate everything
pnpm nx run @discava/docs:translate -- --dry-run
```

There is no CI workflow that runs this automatically yet. If your PR touches English docs, please run the translation locally and commit the result, or note in the PR that translations are pending.
