# CLAUDE.md: packages/tooling/local-dev

Loaded when working in `packages/tooling/local-dev`. The repo-wide rules are in the root [CLAUDE.md](../../../CLAUDE.md).

The Docker services local dev runs instead of AWS, and the scripts that work on local data. Each is invoked by an Nx target; `project.json` lists them. Other projects depend on these targets (`dependsOn` with `"projects": ["@discava/tooling-local-dev"]`); none runs `tsx` on this package's `src/` itself.

Local stand-ins (one folder each under `src/`, with `start-container.ts` and `pull-image.ts`):

- DynamoDB local (`src/dynamodb`): `dynamodb` starts it and creates the local table; run by `@discava/core-table:dev`. Runs in `packages/databases/core-table`, whose `config.json` it reads
- OpenSearch (`src/opensearch`): `opensearch` starts it and syncs the local indices; run by `@discava/search:dev`. Runs in `packages/databases/search`, whose `config.json` it reads
- S3Mock for S3 (`@discava/tooling-local-dev:s3mock`). The portals fetch the published brand (`brand/brand.json`) from it cross-origin, which needs `Access-Control-Allow-Origin`: `src/s3mock/cors.test.ts` checks it whenever S3Mock is running (skipped otherwise). If it ever fails, proxy `/brand` to `http://localhost:9090/discava-public-media/brand` in each portal's Vite config and have `BrandProvider` fetch the same-origin path in local dev
- ElasticMQ for SQS (`@discava/tooling-local-dev:elasticmq`)
- the local OIDC server for Cognito (`@discava/tooling-local-dev:local-oidc`), with its own `src/local-oidc/config.json` and sign-in page in `src/local-oidc/login.html`

Each has a `pull-*-image` target the start target depends on. Local data: `reset-local-data`, `notify-local`.

The local endpoints and bucket names the APIs read at runtime are in `common-server-utils/local-dev`. What only runs on a deployed stage is listed in DEVELOPMENT.md's "Running Discava Locally".
