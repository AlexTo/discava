# CLAUDE.md: packages/tooling/deploy

Loaded when working in `packages/tooling/deploy`. The repo-wide rules are in the root [CLAUDE.md](../../../CLAUDE.md).

Deploy and ops scripts. Each is invoked by an Nx target; `project.json` lists them.

- `src/infra`: the deploy/destroy entry points `packages/infra`'s `deploy`, `deploy-sandbox` and `destroy` targets run, and `reindex-search`, which takes a stage and invokes that stage's search-reindex Lambda, and `reindex-transcripts`, which takes `--stage` (and optionally `--course`) and invokes the stage's transcript-reindex Lambda until no cursor comes back, or runs it in-process against the local stack with no `--stage`. Stage credentials are resolved in `src/infra/stage-credentials`
- `seed-categories` and `rebuild-analytics` write to a table (the local one, or a deployed stage's when `DISCAVA_DYNAMODB_CORE_TABLE` is set)
- `src/setup-stage.test.ts` tests the root `scripts/setup-stage.sh`; the `test-setup-stage` target runs it with `vitest.setup-stage.config.mts`
