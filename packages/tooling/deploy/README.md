# @discava/tooling-deploy

Deploy and ops scripts.

| Target | What it does |
| --- | --- |
| `reindex-search` | Invokes a stage's search-reindex Lambda: `pnpm nx run @discava/tooling-deploy:reindex-search --stage=<stage>` |
| `reindex-transcripts` | Rebuilds the transcripts index, calling the stage's transcript-reindex Lambda until it is done: `pnpm nx run @discava/tooling-deploy:reindex-transcripts --stage=<stage> [--course=<courseId>]`; with no `--stage` it runs against the local stack |
| `seed-categories` | Writes the starting course categories, skipping any that exist; runs against the local table, or a deployed stage's when `DISCAVA_DYNAMODB_CORE_TABLE` is set |
| `rebuild-analytics` | Recomputes a course's analytics: `-- <courseId> [<courseId> ...]` |
| `test-setup-stage` | Runs the tests for the root `scripts/setup-stage.sh` |

`src/infra` holds the entry points behind `packages/infra`'s `deploy`, `deploy-sandbox` and `destroy` targets.

```sh
pnpm nx test @discava/tooling-deploy
```
