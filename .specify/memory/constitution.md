# Discava Constitution

## Core Principles

### I. AWS-Native and Serverless Only
Discava targets one cloud provider (AWS) and one way to deploy (CDK). Features MUST NOT introduce a pluggable or multi-cloud backend, and MUST use managed, serverless AWS services.

Rationale: opinionated simplicity is the product. Every abstraction over the provider is code we maintain for no one.

### II. Generators First
New projects and components MUST be created with an `@aws/nx-plugin` generator (via the `nx-plugin-for-aws` MCP server) when one fits. Hand-scaffolding is allowed only when no generator applies, and the plan MUST say why.

Rationale: generator-owned structure stays upgradeable with the plugin.

### III. Everything Runs Locally
A feature MUST work under `pnpm dev` with Docker and no AWS account. Any AWS service a feature adds MUST get a local stand-in or a documented, justified exception. Backend code switches on `LOCAL_DEV=true`, with shared settings in `common-server-utils/local-dev`.

Rationale: contributors and CI exercise the real flows without a deployed stage.

### IV. Layered Tests: Unit, Invariants, End to End
Each layer has its own job; a feature uses every layer it touches.

- **Unit tests.** New business logic (tRPC procedures, entity access patterns) MUST ship with unit tests covering its main behavior and the rules it enforces (authorization, transactional guarantees).
- **Invariants.** A rule that spans records or writers (core-api, instructor-api, event handlers) MUST be written through a shared `core-table` helper that every writer calls, and MUST have a check in `core-table`'s `helpers/invariants.ts` plus a test that breaks it.
- **End to end.** A change to a main user flow (signing in, building and publishing a course, enrolling, learning) MUST add or extend a scenario in `packages/e2e`. Scenarios MUST make their own users and uniquely named data, MUST NOT reset local data, and MUST keep the invariant check after every test. A new write that two users could race on SHOULD add a concurrency test.
- **Tests are a specification.** A failing test MUST be resolved by fixing the code, unless the spec or plan changes the behavior it covers. Weakening an existing test (loosening an assertion, deleting a case, adding `skip` or `only`, widening a mock or snapshot) is allowed only when a task names the behavior change that justifies it, and the PR description says so. Never edit a test just to turn it green. Invariants count as tests: a violated invariant means the write is wrong, so don't relax the check.

Rationale: unit tests cover logic, invariants cover data that no schema enforces, and end-to-end scenarios cover whole flows. A feature isn't done until each layer it touches passes.

### V. Single-Table Data Model via ElectroDB
All application data lives in the one `core-table` DynamoDB table, defined as ElectroDB entities under `packages/databases/core-table/src/entities/` and grouped into collections in `service.ts`. A feature MUST:

- Add a new record type as an entity in that table, not a second table.
- Design its access patterns up front, in the plan, and serve each user-facing request with a key or a declared index, never a scan. A scan is allowed only in tooling outside a user request (tests, invariant checks, local scripts, admin re-index jobs), and the plan MUST say where.
- Co-locate records read together under a shared partition key, with sort keys that make a parent's children a contiguous range (as `curriculum` does for course, module, lesson and content item).
- Add an index only for an access pattern the plan names, because indexes cost writes and storage.
- Reach the table through `@discava/core-table` (which resolves the client and table for local and deployed use alike), never through a raw DynamoDB client in an API.
- Consider the table's stream consumers (progress, search) when it changes a record they read. Update `PROGRESS_STREAM_FILTERS` or `SEARCH_STREAM_FILTERS` if the change affects what they react to.

Rationale: single-table design fits only if access patterns are known and keys are planned. Retrofitting keys or indexes later means migrating data.

### VI. Secure by Default
Constructs MUST default to fully hardened settings (WAF, KMS encryption, and so on). Only a stage's config in `common/infra-config` may relax them, and `discava-production` is the hardened baseline.

Rationale: a relaxed default is a production hole waiting for a forgotten flag.

### VII. Change Freely Before Launch
Until production is live, there are no real users, links or data to keep compatible. Routes, APIs and data shapes MUST be changed outright: no redirects, deprecated aliases or fallbacks for old data. Fix development data by hand.

Rationale: compatibility code written now is dead weight at launch. Revisit this principle when production goes live.

### VIII. Repository Conventions
- Conventional Commits for commit and PR titles.
- Biome (not ESLint or Prettier) formats and lints.
- Code that isn't an entity or a package's setup goes in a `helpers/` folder, one file per entity or topic. No catch-all `utils.ts`.
- Buttons carry text labels only: no arrow icons. Icon-only controls and breadcrumb separators are fine.
- A browser-tested change saves screenshots of its key steps (and any failure) to the git-ignored `tmp/screenshots/pr-<number>/`.
- A change to English docs is translated locally and committed, or the PR notes that translations are pending.
- Runtime code shared by backend Lambdas goes in `common-server-utils`, and non-UI code shared by portals goes in `common-web-utils`. Code only one consumer uses stays beside it.

## Additional Constraints

- Stack composition stays within CloudFormation's 500-resource limit per stack. Stateful resources live in the `Data` stack.
- Constructs own one component's resources. `packages/infra` composes them into stacks.
- SPDX copyright headers are generator-managed and MUST NOT be edited by hand.

## Development Workflow

- Run `pnpm build` (or `pnpm nx affected --target build`) before pushing. CI's PR checks run lint, test and build on what changed.
- Follow CONTRIBUTING.md for the PR process. [CLAUDE.md](../../CLAUDE.md) holds the day-to-day commands and architecture notes; this constitution holds only the rules a plan must not break.
- Plans MUST pass the Constitution Check against the principles above, and any violation MUST be recorded in the plan's Complexity Tracking with a justification.

## Governance

This constitution supersedes other practices where they conflict. Amend it by pull request, with the rationale in the description. Versioning is semantic: MAJOR for removing or redefining a principle, MINOR for adding a principle or materially widening one, PATCH for clarifications. Reviewers MUST check that each PR complies.

**Version**: 1.0.0 | **Ratified**: 2026-11-07 | **Last Amended**: 2026-11-07
