# @discava/tooling-local-dev

The Docker services local dev runs instead of AWS, and the scripts that work on local data.

| Target | What it does |
| --- | --- |
| `dynamodb` | Starts DynamoDB local and creates the local table (run by `@discava/core-table:dev`) |
| `opensearch` | Starts OpenSearch and syncs the local indices (run by `@discava/search:dev`) |
| `s3mock` | Starts S3Mock |
| `elasticmq` | Starts ElasticMQ |
| `local-oidc` | Starts the local OIDC server that stands in for Cognito |
| `pull-*-image` | Pulls each service's image; the start targets depend on them |
| `reset-local-data` | Wipes local data (stop `pnpm dev` first) |
| `notify-local` | Publishes a notification to a local user; see DEVELOPMENT.md |

`pnpm dev` starts the services through the projects that need them, so you rarely run these by hand:

```sh
pnpm nx run @discava/tooling-local-dev:reset-local-data
pnpm nx test @discava/tooling-local-dev
```
