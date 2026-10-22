# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a PR; it covers the PR process, commit conventions, and when to prefer an Nx generator over hand-scaffolding.

## What this is

Discava: a serverless, AWS-native Learning Management System. Opinionated by design, one cloud provider (AWS), one way to deploy (CDK), rather than a pluggable backend. Nx monorepo (pnpm workspaces) scaffolded and maintained with [`@aws/nx-plugin`](https://awslabs.github.io/nx-plugin-for-aws). Use the `nx-plugin-for-aws` MCP server (`list-generators`, `generator-guide`, `general-guidance`) before hand-writing new projects/components; prefer its generators over manual scaffolding.

## Commands

Install:

```sh
pnpm i
```

Build / lint / test everything:

```sh
pnpm build          # nx run-many --target build (compile, bundle, synth, checkov, etc. per project)
pnpm lint           # nx run-many --target lint --configuration=fix
pnpm test           # nx run-many --target test --all
```

Run a single project's target, or affected-only (what CI's PR checks use):

```sh
pnpm nx run @discava/core-api:test              # watch mode (nx.json testMode: watch)
pnpm nx run @discava/core-api:test -- --run auth.test.ts   # single file, run once
pnpm nx affected --target test
```

Update vitest snapshots for one project:

```sh
pnpm nx run @discava/core-api:test -u
```

Local dev: Docker running, then the dev servers. No AWS account or deployed stage is needed; everything AWS runs locally (see CONTRIBUTING.md's "Running Discava Locally" and `common-server-utils/local-dev`):

```sh
pnpm dev                                              # portals, APIs, DynamoDB local, S3Mock, event runner, local OIDC
pnpm nx run @discava/common-scripts:reset-local-data  # wipe local data (stop pnpm dev first)
```

Sign in locally as Alice (instructor, student), Bob or Dan (students) or Carol (admin) on the local OIDC page; Cognito itself is only exercised on a deployed stage:

```sh
pnpm nx deploy @discava/infra "discava-development/*"
```

Deploy the hardened production stage instead of `discava-development`: `pnpm nx deploy @discava/infra "discava-production/*"`.

Everything else (`compile`, `bundle`, `synth`, `checkov`, `dev`, `serve`) is a per-project Nx target. Check that project's `project.json` rather than assuming a script exists.

## Architecture

- `packages/apis/core-api`: tRPC API (`@discava/core-api`) behind API Gateway, for procedures any authenticated user can call: one shared router Lambda, plus dedicated functions for procedures needing more than the table (`CORE_API_DEDICATED_FUNCTIONS`, e.g. `contentItem.videoUrl` holding the CloudFront signing key)
- `packages/apis/instructor-api`: separate tRPC API (`@discava/instructor-api`), separate Lambda/API Gateway, for procedures only instructors may call (e.g. creating/archiving courses); same Cognito user pool as `core-api`
- `packages/databases/core-table`: single-table DynamoDB access via ElectroDB; `client.ts` resolves table/client so entities work identically against local (Docker) and deployed DynamoDB
- `packages/common/scripts`: deploy/destroy tooling, and the Docker services local dev runs instead of AWS (DynamoDB local; S3Mock for S3, `@discava/common-scripts:s3mock`; the local OIDC server for Cognito, `@discava/common-scripts:local-oidc`, with its sign-in page in `src/local-oidc/login.html`; and `reset-local-data`), invoked by Nx targets. Their settings for the APIs are in `common-server-utils/local-dev` (S3 endpoint, local bucket names); see #137 for what still runs only on dev
- `packages/events`: standalone Lambda handlers for AWS-triggered events (e.g. Cognito), separate from the API. In local dev, its `dev` target runs the event runner (`src/local/event-runner.ts`), which triggers those handlers locally the way AWS does when deployed: the core table's stream → progress recalculation (filtered by core-table's `PROGRESS_STREAM_FILTERS`, which the deployed event source mapping also uses), and, standing in for MediaConvert and EventBridge Scheduler on port 2024, ffmpeg transcodes in Docker (`src/local/transcoder.ts`, working in the git-ignored `tmp/local-dev/transcode/`; `LOCAL_TRANSCODE_RENDITIONS=360p` for speed) → transcode-complete, and delayed cleanups → transcode-cleanup. Backend code switches to these and S3Mock when `LOCAL_DEV=true` (see `common-server-utils/local-dev`); #137 lists what still runs only on dev
- `packages/websites/student-portal`, `packages/websites/instructor-portal`, `packages/websites/admin-portal`: React + Vite + TanStack Router frontends
- `packages/common/constructs`: all CDK constructs. A construct owns one component's own resources (e.g. an API with its handlers and WAF) and exposes `grant*`/`restrictCorsTo`-style helpers; `lambda-functions/` holds the generator-owned bare `Function` wrappers. `packages/infra` composes them into stacks, translating per-stage config into construct props and wiring components together (cross-component grants, CORS, event triggers such as EventBridge rules or DynamoDB stream sources).
- `packages/common/infra-config`: per-stage deployment config (credentials, region, which security features are on)
- `packages/common/shadcn`: shared shadcn/ui components used by all three portals
- `packages/common/server-utils`: runtime code shared by two or more backend Lambdas (CORS, lesson media signing), imported per module (`@discava/common-server-utils/cors`); server-only, and a Biome rule stops the portals importing it. Code only one Lambda uses stays next to it
- `docs`: Astro/Starlight docs site, deployed to GitHub Pages on push to `main`

Stack composition (`packages/infra/src/stages/application-stage.ts`) splits the app into stacks under `packages/infra/src/stacks/` (`Websites`, `Data`, `MediaPipeline`, `CoreApi`, `InstructorApi`, `RuntimeConfig`) to stay under CloudFormation's 500-resource limit; the stage's doc comment has the dependency order. Stateful resources (user pool, table, media buckets) live in `Data`; AppConfig content and each portal's `runtime-config.json` live in `RuntimeConfig`, which deploys last because it reads from every other stack. The stacks wire the constructs together and read per-component config (`enableWaf`, `enableKmsEncryption`, etc.) that defaults to fully-hardened and is only relaxed per stage. Stages themselves are defined in `packages/common/infra-config/src/stages.config.ts`, not in `packages/infra`; adding a stage means editing that file only. `discava-development` relaxes security for cheap iteration; `discava-production` is the hardened baseline.

The tRPC router (`packages/apis/core-api/src/router.ts`) builds procedures from middleware plugins in `init.ts`; `protectedProcedure` additionally requires `ctx.user`. `src/handler.ts` is the deployed Lambda entrypoint; `src/local-server.ts` is what `nx dev` runs locally and decodes JWTs itself (no API Gateway in front locally). See `middleware/auth.ts` for how the two are reconciled.

`instructor-api` follows the same `init.ts`/`router.ts`/`handler.ts`/`local-server.ts` shape, but its `protectedProcedure` additionally requires the caller be in the `instructor` Cognito group, throwing `FORBIDDEN` otherwise. Procedures needing DynamoDB access build on `courseProcedure` (`protectedProcedure` + `ctx.coreTable`, see `middleware/core-table.ts`) — this plugin is hand-written, not generated: the installed `@aws/nx-plugin` version's `connection` generator doesn't support a tRPC→DynamoDB combination, only tRPC→RDB. Any project newly wiring up `@discava/core-table` also needs `electrodb`/`@aws-sdk/client-dynamodb` as direct dependencies (not just transitively via `@discava/core-table`) — without them, `tsc --build` fails with a "cannot be named without a reference" (TS2883) error, since it can't print a portable type for anything touching core-table's `Service`.

`lint` depends on the workspace-level `license-check` sync generator (SPDX headers). Don't hand-edit copyright headers; they're generator-managed.

## Conventions

- Conventional Commits for commit and PR titles (enforced by commitlint via husky).
- Biome (not ESLint/Prettier) formats and lints.
- Pre-commit runs `git-secrets` and `lint-staged`, and fails if either mutated the working tree. Stage the result and recommit.
- New business logic (tRPC procedures, entity access patterns) should ship with unit tests covering the main behavior and any invariants it's meant to enforce (authorization, transactional guarantees, etc.) — see `packages/apis/instructor-api/src/procedures/course.test.ts` for the pattern (`t.createCallerFactory`, mocking dependencies with `vi.mock`). Testing anything that imports `@discava/core-table` needs a `resolve.alias` in that project's `vitest.config.mts` (see instructor-api's) — Vite doesn't resolve it via tsconfig `paths` the way `tsc`/`tsx` do.
- When testing a change in the browser (locally or after deploying), save screenshots of the key steps, including any failure, to `tmp/screenshots/pr-<number>/` with numbered, descriptive names (`01-crop-dialog.png`, `02-…`). `tmp/` is git-ignored: screenshots don't go in commits, branches or PR comments unless asked.
- Buttons carry text labels only: no left/right arrow icons (`ArrowLeft`, `ArrowRight`, `ChevronRight`…), leading or trailing, including `Button asChild` links like "Continue" or "Back". Icon-only arrow controls (carousel prev/next) and breadcrumb separators are fine.
- Code that isn't an entity or a package's setup goes in a `helpers/` folder, one file per entity or topic, named for what it covers (e.g. `core-table/src/helpers/content-item.ts` beside `entities/content-item.ts`, `helpers/errors.ts`). Don't leave such files loose at a package's `src/` root or add a catch-all `utils.ts`.
- Discava hasn't launched: there are no real users, links or data to stay compatible with. When moving or renaming routes, APIs or data shapes, change them outright. Don't add redirects for old URLs, deprecated aliases or fallbacks for old data; fix up dev data by hand instead. Revisit this once production is live.
