# Contributing Guidelines

Thank you for your interest in contributing to Discava. Whether it's a bug report, new feature, correction, or additional documentation, we greatly value feedback and contributions.

Please read through this document before submitting any issues or pull requests to ensure we have all the necessary information to effectively respond to your bug report or contribution. This is a young project, so for anything beyond a small fix, please open an issue to discuss the approach first; we'd hate for your time to be wasted.

## Reporting Bugs/Feature Requests

We welcome you to use the GitHub issue tracker to report bugs or suggest features.

When filing an issue, please check existing open, or recently closed, issues to make sure somebody else hasn't already reported it. Please try to include as much information as you can. Details like these are incredibly useful:

- A reproducible test case or series of steps
- The stage/environment you hit it in (`discava-development` vs `discava-production`, local vs deployed)
- Any modifications you've made relevant to the bug
- Anything unusual about your environment or setup

## Contributing via Pull Requests

Contributions via pull requests are much appreciated. Before sending us a pull request, please ensure that:

1. You are working against the latest source on the `main` branch.
2. You check existing open, and recently merged, pull requests to make sure someone else hasn't already addressed the problem.
3. You open an issue to discuss any significant work.

To send us a pull request, please:

1. Fork the repository, and install dependencies with `pnpm i`.
2. Modify the source; please focus on the specific change you are contributing. If you also reformat unrelated code, it will be hard for us to review your change.
3. Run the full build locally before pushing: `pnpm build` (this chains lint, compile, test, and bundle/synth/checkov per project). For a faster loop while iterating, target one project, or run `pnpm nx affected --target <lint|test|build>` to only touch what your change affects, the same way CI's PR checks do.
4. Commit using `git commit` as usual; the `prepare-commit-msg` hook runs [Commitizen](https://commitizen.github.io/cz-cli/) to build a [Conventional Commits](https://www.conventionalcommits.org) message interactively, and `commitlint` enforces it on `commit-msg`. PR titles follow the same convention.
5. Send us a pull request, and keep an eye on CI. `pr-checks.yml` runs lint/test/build against your changes; stay involved if anything reports a failure.

GitHub provides additional documentation on [forking a repository](https://help.github.com/articles/fork-a-repo/) and [creating a pull request](https://help.github.com/articles/creating-a-pull-request/).

### Running Discava Locally

Local dev needs **Docker** running, and no AWS account or deployed stage:

```sh
pnpm i
pnpm dev
```

`pnpm dev` starts the APIs, the three portals, and local stand-ins for the AWS services they use:

| Service | Port | Stands in for |
| --- | --- | --- |
| Student / instructor / admin portal | 4201 / 4200 / 4202 | CloudFront |
| core-api / instructor-api | 2022 / 2023 | API Gateway and Lambda |
| DynamoDB local | 8001 | DynamoDB |
| S3Mock | 9090 | S3 (uploads, lesson media, course images) |
| Event runner | 2024 | MediaConvert (ffmpeg in Docker), EventBridge, Scheduler, the table's stream, and Cognito's pre token generation trigger (which keeps user records in step) |
| Local OIDC server | 9400 | Cognito |

**Signing in.** The portals send you to a local sign-in page: pick **Alice** (instructor and student), **Bob** (student), **Dan** (a second student, e.g. one who isn't enrolled) or **Carol** (admin). There are no passwords. Under "Someone else" you can sign in with any claims, such as other groups. Cognito itself (Managed Login, sign-up, the post-confirmation trigger) is tested on the deployed `discava-development` stage.

**Lesson videos** transcode on your machine with ffmpeg: a few minutes for a long lecture. `LOCAL_TRANSCODE_RENDITIONS=360p pnpm dev` makes only the 360p rendition, for speed. Jobs work in the git-ignored `tmp/local-dev/transcode/`, and a failed job keeps its files and an `error.log` there. Course progress updates a few seconds after a change, as when deployed.

**Starting fresh.** Local data lives in Docker volumes and survives restarts. To delete it all, stop `pnpm dev`, then run:

```sh
pnpm nx run @discava/common-scripts:reset-local-data
```

**What only runs on dev:** CloudFront signing and cookies, MediaConvert's exact encoding, Cognito Managed Login and sign-up, EventBridge and stream retries, the failure queues, and the stuck-video reconciler. Check changes to those after deploying.

### Adding a New Project or Component

Prefer the [Nx Plugin for AWS](https://awslabs.github.io/nx-plugin-for-aws) generators over hand-scaffolding. That's how every existing package in this repo (`core-api`, `core-table`, the portals, `infra`) was created, and it keeps generated projects consistent and eligible for future `nx migrate` upgrades. If you have the `nx-plugin-for-aws` MCP server available, use `list-generators` / `generator-guide` to find the right one; otherwise check the [generator docs](https://awslabs.github.io/nx-plugin-for-aws/en/guides/).

### Code Style and License Headers

[Biome](https://biomejs.dev) formats and lints this codebase (single quotes, trailing commas, 80-column width); `pnpm lint` runs it with `--configuration=fix`. Every source file, except generated output, translated docs, and `.astro` files, carries an Apache-2.0 SPDX header, written by the `license#sync` Nx sync generator (configured in [aws-nx-plugin.config.mts](aws-nx-plugin.config.mts)). Please don't hand-edit headers; `pnpm lint` and `pnpm build` keep them in sync for you.

### Rules That Span Records

Every API and event handler shares the core table, and some rules span records that different writers touch. For example, core-api counts the students who have used an item (`studentActivityCount`), and instructor-api relies on that count to refuse deleting the item. A write that keeps a rule another API or handler depends on goes in a `core-table` helper, for example `studentActivityWrites` in `helpers/student-activity.ts`, and every procedure making that write calls the helper. Don't write it by hand in each procedure. A rule that only one API keeps can stay in that API.

Add a check for each such rule to `core-table`'s `helpers/invariants.ts`. The e2e suite runs those checks after every scenario (see [End-to-End Tests](#end-to-end-tests)).

### Testing Portal Components

The instructor portal's components are tested with [Vitest](https://vitest.dev) and [Testing Library](https://testing-library.com/docs/react-testing-library/intro), in jsdom. Put a test next to the component as `<name>.test.tsx`.

Render it with `renderWithInstructorApi` from `src/test/render-with-instructor-api.tsx`. It wraps the component in a fresh React Query client and the real tRPC client, answered by handlers you give per procedure instead of the network:

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
- A page that reads from core-api instead (the instructor portal's My Courses and Dashboard do, for the course list) uses `renderWithCoreApi` from `src/test/render-with-core-api.tsx` the same way. Both share their fake tRPC `fetch` from `src/test/fake-trpc-fetch.ts`.
- A `route.tsx`'s component isn't exported directly; render `Route.options.component` from it. Name the test file `-route.test.tsx` (the `-` prefix), or TanStack Router's file-based routing picks it up as a route of its own.

### End-to-End Tests

`packages/e2e` drives the portals in Chromium with [Playwright](https://playwright.dev), against the whole local stack from `pnpm dev`. PR checks run it whenever the portals, APIs or event handlers change. To run it yourself, with Docker running (it reuses a running `pnpm dev`, or starts one):

```sh
pnpm --filter @discava/e2e exec playwright install chromium   # once
pnpm nx e2e @discava/e2e
```

A change to a main user flow should come with an end-to-end scenario, or an extended one. The flows are signing in, building and publishing a course, enrolling, and learning. See [`packages/e2e/README.md`](./packages/e2e/README.md) for the helpers and the rules on test data.

### Writing Documentation

Docs live in `docs/` (Astro + Starlight, deployed to GitHub Pages). Please only author English content, under `docs/src/content/docs/en/`; other locales are generated from it, not hand-written.

To translate your changes locally, with AWS credentials configured for Bedrock access:

```sh
pnpm nx run @discava/docs:translate            # translate files changed vs main
pnpm nx run @discava/docs:translate -- --all   # translate everything
pnpm nx run @discava/docs:translate -- --dry-run
```

There is no CI workflow that runs this automatically yet. If your PR touches English docs, please run the translation locally and commit the result, or note in the PR that translations are pending.

## Finding Contributions to Work On

Looking at the existing issues is a great way to find something to contribute. Take a look at any [`good first issue`](https://github.com/AlexTo/discava/labels/good%20first%20issue) or [`help wanted`](https://github.com/AlexTo/discava/labels/help%20wanted) issues to get started.

## Code of Conduct

This project has adopted the [Contributor Covenant](CODE_OF_CONDUCT.md). Please read it before participating, and report unacceptable behavior as described there.

## Security Issue Notifications

See [SECURITY.md](SECURITY.md) for how to report a potential security issue. Please do not open a public GitHub issue for it.

## Licensing

See the [LICENSE](LICENSE) file for our project's licensing (Apache License 2.0). We will ask you to confirm the licensing of your contribution.
