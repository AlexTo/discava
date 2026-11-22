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

End-to-end tests (Playwright, `packages/e2e`) against the local stack, reusing a running `pnpm dev` or starting one; needs Docker and, once, `pnpm --filter @discava/e2e exec playwright install chromium`:

```sh
pnpm nx e2e @discava/e2e
```

Update vitest snapshots for one project:

```sh
pnpm nx run @discava/core-api:test -u
```

Local dev needs Docker running and no AWS account or deployed stage. Ports, the sign-in users (Alice, Bob, Dan, Carol), which AWS service each local service stands in for, and what only runs on a deployed stage are in CONTRIBUTING.md's [Running Discava Locally](./CONTRIBUTING.md#running-discava-locally):

```sh
pnpm dev                                              # portals, APIs and local stand-ins for the AWS services they use
pnpm nx run @discava/tooling-local-dev:reset-local-data  # wipe local data (stop pnpm dev first)
```

Cognito itself is only exercised on a deployed stage:

```sh
pnpm nx deploy @discava/infra "discava-development/*"
```

Deploy the hardened production stage instead of `discava-development`: `pnpm nx deploy @discava/infra "discava-production/*"`.

Everything else (`compile`, `bundle`, `synth`, `checkov`, `dev`, `serve`) is a per-project Nx target. Check that project's `project.json` rather than assuming a script exists.

## Architecture

Nested `CLAUDE.md` files hold the detail for the packages below that name one; Claude Code loads them only when you work in that directory.

- `packages/apis/{core-api,instructor-api,admin-api}`: the three tRPC APIs (`@discava/<name>`), each with its own Lambda and API Gateway; see `packages/apis/CLAUDE.md`
- core-api's second handler, `src/page-renderer/`, renders public course landing pages, instructor profiles, `sitemap.xml` and `robots.txt` as HTML for crawlers. The student portal's CloudFront distribution serves it for `/learn/*` and `/instructors/*`, and `pnpm dev` runs it on port 2026 (`src/local-page-renderer.ts`); see the docs' Public pages design page
- `packages/databases/core-table`: single-table DynamoDB access via ElectroDB; see `packages/databases/core-table/CLAUDE.md`
- `packages/databases/search`: OpenSearch (`@discava/search`): the client (`getOpenSearchClient`, endpoint and index-name resolution), the index definitions in `src/indices/` (today the `courses` index and its zod document schema), and `src/index-sync/`, the Lambda handler and `syncIndices` that create or update indices from the generated indices manifest. Its `dev` target starts OpenSearch in Docker and syncs the local indices; the search-indexing stream feature writes to it and core-api's search procedure reads from it
- `packages/common/tiptap`: rich-text document helpers (`@discava/common-tiptap`) shared by the portals and the APIs: `createContentExtensions` (the Tiptap schema, StarterKit plus LaTeX maths), `isValidTiptapDocument` / `parseTiptapDocument` for stored JSON, `renderLatex` and `plainTextExcerpt`. Extensions are added there, never in one consumer
- `packages/tooling/local-dev`: the Docker services local dev runs instead of AWS (DynamoDB local, OpenSearch, S3Mock, ElasticMQ, the local OIDC server) and the local-data scripts; see `packages/tooling/local-dev/CLAUDE.md`
- `packages/tooling/agent`: the agent and PR tooling CI runs (issue picking, CI and review status, UI screenshots, invariant coverage); see `packages/tooling/agent/CLAUDE.md`
- `packages/tooling/deploy`: deploy and ops scripts (stage credentials for deploy/destroy, search reindex, category seeding, analytics rebuild) and the tests for `scripts/setup-stage.sh`; see `packages/tooling/deploy/CLAUDE.md`
- `packages/events`: standalone Lambda handlers for AWS-triggered events and the local event runner; see `packages/events/CLAUDE.md`
- `packages/infra`: CDK stacks and stages; see `packages/infra/CLAUDE.md`
- `packages/common/constructs`: all CDK constructs; see `packages/common/constructs/CLAUDE.md`
- `packages/common/infra-config`: per-stage deployment config and the local portals' ports and origins; see `packages/common/infra-config/CLAUDE.md`
- `packages/websites/student-portal`, `packages/websites/instructor-portal`, `packages/websites/admin-portal`: React + Vite + TanStack Router frontends
- `packages/websites`: UI rules for every portal screen and shared component: the two widths and states to check, layout, links, focus, errors; see `packages/websites/CLAUDE.md`
- `packages/common/shadcn` (see `packages/websites/CLAUDE.md`): shared shadcn/ui components used by all three portals, plus `ErrorAlert` and the portals' shared shell: `CognitoAuth` (`autoSignIn`, `onReturn(path)`), `NotificationBell` (`notification-bell-container`, takes `portal`), `UserMenu`, `PortalShell` (sidebar, header and breadcrumbs from `navItems`, `label` and `segmentLabels`; routes set a crumb with `useBreadcrumbLabel`), and the core API's context and hooks (`lib/core-api`), which each portal's `api.ts` builds its provider over
- `packages/common/web-utils`: non-UI code shared by two or more portals (types, pure logic, browser helpers, e.g. `quiz`, `return-to`, `video-player`: speeds, keyboard shortcut mapping and saved player preferences for the shared `HlsVideo` controls), imported per module (`@discava/common-web-utils/return-to`); `testing` holds the test-only helpers the portals and `common-shadcn` share (`fakeTrpcFetch`, `createRenderWithApi`, `installJsdomStubs`, `mockRouter`), imported by tests and test setup only, never by portal source; the portals' shared bootstrap: `runtime-config` (context, provider and hook; each portal passes its local-dev config in), `trpc-provider` (`createTrpcProvider<AppRouter>({ apiKey, credentials })`, which each portal calls once in its `src/api.ts`; the router type is a generic, so web-utils never imports an API package), `query-client`, `public-media-url`, `app-config` and `user-profile` (the signed-in user's display name and initials); the frontend counterpart of `common-server-utils`. UI goes in `common-shadcn`, and code only one portal uses stays in it
- `packages/common/branding`: shared branding rules for the portals and the backend (`@discava/common-branding`): the brand document, colour palette and contrast rules, and brand image rules, imported per module
- `packages/common/server-utils`: runtime code shared by two or more backend Lambdas (CORS, lesson media signing), imported per module (`@discava/common-server-utils/cors`); server-only, and a Biome rule stops the portals importing it. Code only one Lambda uses stays next to it
- `packages/e2e`: Playwright end-to-end tests (#3), one `src/scenarios/*.e2e.ts` per user flow, built from `src/helpers/`, against the local stack; each scenario makes its own users (the local OIDC page's "Someone else" form) and uniquely named data, and never resets local data. `src/concurrency/` fires API requests at the same moment (#71). After every test, the core table must still keep core-table's `helpers/invariants/` rules
- `docs`: Astro/Starlight docs site, deployed to GitHub Pages on push to `main`

`lint` depends on the workspace-level `license-check` sync generator (SPDX headers). Don't hand-edit copyright headers; they're generator-managed.

## Conventions

- Conventional Commits for commit and PR titles (enforced by commitlint via husky).
- Biome (not ESLint/Prettier) formats and lints.
- Pre-commit runs `git-secrets` and `lint-staged`, and fails if either mutated the working tree. Stage the result and recommit.
- A write that keeps a rule another API or handler relies on goes in a `core-table` helper every writer calls, with a check in `helpers/invariants/`. The details, and the `entity-writers` regeneration the `Invariant coverage` PR check needs, are in `packages/databases/core-table/CLAUDE.md`.
- New business logic (tRPC procedures, entity access patterns) should ship with unit tests covering the main behavior and any invariants it's meant to enforce (authorization, transactional guarantees, etc.); `packages/apis/CLAUDE.md` has the pattern.
- When testing a change in the browser (locally or after deploying), save screenshots of the key steps, including any failure, to `tmp/screenshots/pr-<number>/` with numbered, descriptive names (`01-crop-dialog.png`, `02-…`). `tmp/` is git-ignored: screenshots don't go in commits, branches or PR comments unless asked.
- Buttons carry text labels only: no left/right arrow icons (`ArrowLeft`, `ArrowRight`, `ChevronRight`…), leading or trailing, including `Button asChild` links like "Continue" or "Back". Icon-only arrow controls (carousel prev/next) and breadcrumb separators are fine.
- Code that isn't an entity or a package's setup goes in a `helpers/` folder, one file per entity or topic, named for what it covers (e.g. `core-table/src/helpers/content-item.ts` beside `entities/content-item.ts`, `helpers/errors.ts`). Don't leave such files loose at a package's `src/` root or add a catch-all `utils.ts`. The exception is a package imported per module (`common-server-utils`, `common-web-utils`): each `src/` file there is a public module.
- File names are kebab-case, components included. In the portals, route-private code lives in a `-components/` folder beside the route, non-UI code in `lib/`, and hooks in `hooks/`.
- Backend packages use `helpers/`, never `lib/`.
- In core-table, a `*Writes` function returns transaction items for the caller to run, and a verb-named function (`issueCertificate`, `publishNotification`, …) runs its own I/O.
- Discava hasn't launched: there are no real users, links or data to stay compatible with. When moving or renaming routes, APIs or data shapes, change them outright. Don't add redirects for old URLs, deprecated aliases or fallbacks for old data; fix up dev data by hand instead. Revisit this once production is live.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost). Every `build` runs `@discava/source:graphify-update` first (skipped in CI or when graphify isn't installed).
- `/graphify` runs the installed graphify skill (`.claude/skills/graphify/SKILL.md`); use it before anything else when the user types it.
- `.graphifyignore` (gitignore syntax) keeps tooling, lockfiles and generated output out of the graph.
