# @discava/tooling-deploy

Deploy and ops scripts.

| Target | What it does |
| --- | --- |
| `reindex-search` | Invokes a stage's search-reindex Lambda: `pnpm nx run @discava/tooling-deploy:reindex-search --stage=<stage>` |
| `seed-categories` | Writes the starting course categories, skipping any that exist; runs against the local table, or a deployed stage's when `RUNTIME_CONFIG_APP_ID` is set |
| `rebuild-analytics` | Recomputes a course's analytics: `-- <courseId> [<courseId> ...]` |
| `test-setup-stage` | Runs the tests for the root `scripts/setup-stage.sh` |

`src/infra` holds the entry points behind `packages/infra`'s `deploy`, `deploy-sandbox` and `destroy` targets.

```sh
pnpm nx test @discava/tooling-deploy
```
