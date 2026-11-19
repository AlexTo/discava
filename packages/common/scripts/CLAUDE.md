# CLAUDE.md: packages/common/scripts

Loaded when working in `packages/common/scripts`. The repo-wide rules are in the root [CLAUDE.md](../../../CLAUDE.md).

Deploy/destroy tooling, repo maintenance scripts, and the Docker services local dev runs instead of AWS. Each is invoked by an Nx target; `project.json` lists them.

Local stand-ins (one folder each under `src/`, with `start-container.ts` and `pull-image.ts`):

- DynamoDB local (`src/dynamodb`), started by `@discava/core-table:dev`, which also creates the local table
- OpenSearch (`src/opensearch`), started by `@discava/search:dev`, which also syncs the local indices
- S3Mock for S3 (`@discava/common-scripts:s3mock`)
- ElasticMQ for SQS (`@discava/common-scripts:elasticmq`)
- the local OIDC server for Cognito (`@discava/common-scripts:local-oidc`), with its own `src/local-oidc/config.json` and sign-in page in `src/local-oidc/login.html`

Local data: `reset-local-data`, `seed-categories`, `rebuild-analytics`, `notify-local`. `reindex-search` takes a stage and invokes that stage's search-reindex Lambda. Core-table checks: `entity-writers` and `invariant-coverage` (see `packages/databases/core-table/CLAUDE.md`).

The local endpoints and bucket names the APIs read at runtime are in `common-server-utils/local-dev`. What only runs on a deployed stage is listed in CONTRIBUTING.md's "Running Discava Locally".
