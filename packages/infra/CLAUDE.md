# CLAUDE.md: packages/infra

Loaded when working in `packages/infra` or `packages/common/constructs`. The repo-wide rules are in the root [CLAUDE.md](../../CLAUDE.md).

## Stacks

Stack composition (`packages/infra/src/stages/application-stage.ts`) splits the app into stacks under `packages/infra/src/stacks/` to stay under CloudFormation's 500-resource limit; the stage's doc comment lists the stacks and their dependency order. Stateful resources (user pool, table, media buckets) live in `Data`; AppConfig content and each portal's `runtime-config.json` live in `RuntimeConfig`, which deploys last because it reads from every other stack. The stacks wire the constructs together and read per-component config (`enableWaf`, `enableKmsEncryption`, etc.) that defaults to fully-hardened and is only relaxed per stage.

Stages themselves are defined in `packages/common/infra-config/src/stages.config.ts`, not in `packages/infra`; adding a stage means editing that file only. `discava-development` relaxes security for cheap iteration; `discava-production` is the hardened baseline.

`packages/infra` composes constructs into stacks, translating per-stage config into construct props and wiring components together (cross-component grants, CORS, event triggers such as EventBridge rules). The core table's stream has one reader, the `StreamRouter` construct, and a feature adds a `STREAM_FEATURES` registration rather than its own stream source.

## Constructs (`packages/common/constructs`)

All CDK constructs live here. A construct owns one component's own resources (e.g. an API with its handlers and WAF) and exposes `grant*`/`restrictCorsTo`-style helpers; `lambda-functions/` holds the generator-owned bare `Function` wrappers.

## infra-config (`packages/common/infra-config`)

Per-stage deployment config (credentials, region, which security features are on), and the one definition of the local portals' ports and origins (`local-portals`, imported per module as `@discava/common-infra-config/local-portals` by the stacks, constructs, local dev, e2e and the portals' vite configs).
