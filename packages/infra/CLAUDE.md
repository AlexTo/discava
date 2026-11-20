# CLAUDE.md: packages/infra

Loaded when working in `packages/infra`. The repo-wide rules are in the root [CLAUDE.md](../../CLAUDE.md).

## Stacks

Stack composition (`packages/infra/src/stages/application-stage.ts`) splits the app into stacks under `packages/infra/src/stacks/` to stay under CloudFormation's 500-resource limit; the stage's doc comment lists the stacks and their dependency order. Stateful resources (user pool, table, media buckets) live in `Data`; AppConfig content and each portal's `runtime-config.json` live in `RuntimeConfig`, which deploys last because it reads from every other stack. The stacks wire the constructs together and read per-component config (`enableWaf`, `enableKmsEncryption`, etc.) that defaults to fully-hardened and is only relaxed per stage.

Stages themselves are defined in `packages/common/infra-config/src/stages.config.ts`, not in `packages/infra`; adding a stage means editing that file only. `discava-development` relaxes security for cheap iteration; `discava-production` is the hardened baseline.

`packages/infra` composes constructs into stacks, translating per-stage config into construct props and wiring components together (cross-component grants, CORS, event triggers such as EventBridge rules). The core table's stream has one reader, the `StreamRouter` construct, and a feature adds a `STREAM_FEATURES` registration rather than its own stream source.

## Deploy permissions

CI deploys through the `cfn-execution-<stage>` role and caps every role the stacks create with `permissions-boundary-<stage>`, both written by `scripts/setup-stage.sh`. A local `cdk deploy` uses CDK's admin bootstrap role instead, so a stack that deploys locally can still fail in CI. When adding a new kind of resource:

- Add what CloudFormation needs to the execution role's policies, and what the functions need at runtime to the boundary. The execution role carries no boundary, so a permission added to the boundary never fixes a deploy.
- Both are scoped by name prefix (`<stage>-*`, or `<stage without hyphens>*` for secrets and some other kinds). Give a resource whose CloudFormation-generated name wouldn't match an explicit name, e.g. `Names.uniqueResourceName(this, { separator: '/' })` as the Stripe and unsubscribe secrets do.
- Cover the new statements in `packages/tooling/deploy/src/setup-stage.test.ts`, and re-run the script for each stage before the deploy.

The constructs it composes are described in `packages/common/constructs/CLAUDE.md`, and the per-stage config in `packages/common/infra-config/CLAUDE.md`.
