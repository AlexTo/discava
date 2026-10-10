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

Local dev, deploy once, pull runtime config, then run dev servers:

```sh
pnpm nx deploy @discava/infra "discava-development/*"
pnpm nx load-runtime-config @discava/student-portal
pnpm nx load-runtime-config @discava/instructor-portal
pnpm nx load-runtime-config @discava/admin-portal
pnpm dev
```

Deploy the hardened production stage instead of `discava-development`: `pnpm nx deploy @discava/infra "discava-production/*"`.

Everything else (`compile`, `bundle`, `synth`, `checkov`, `dev`, `serve`) is a per-project Nx target. Check that project's `project.json` rather than assuming a script exists.

## Architecture

- `packages/apis/core-api`: tRPC API (`@discava/core-api`), one Lambda behind API Gateway, for procedures any authenticated user can call
- `packages/apis/instructor-api`: separate tRPC API (`@discava/instructor-api`), separate Lambda/API Gateway, for procedures only instructors may call (e.g. creating/archiving courses); same Cognito user pool as `core-api`
- `packages/databases/core-table`: single-table DynamoDB access via ElectroDB; `client.ts` resolves table/client so entities work identically against local (Docker) and deployed DynamoDB
- `packages/common/scripts`: deploy/destroy and local-DynamoDB (Docker) tooling invoked by Nx targets
- `packages/events`: standalone Lambda handlers for AWS-triggered events (e.g. Cognito), separate from the API
- `packages/websites/student-portal`, `packages/websites/instructor-portal`, `packages/websites/admin-portal`: React + Vite + TanStack Router frontends
- `packages/common/constructs`: all CDK constructs; `packages/infra` composes them into stacks and has no infra logic of its own
- `packages/common/infra-config`: per-stage deployment config (credentials, region, which security features are on)
- `packages/common/shadcn`: shared shadcn/ui components used by all three portals
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
