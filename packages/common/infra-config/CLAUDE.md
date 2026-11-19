# CLAUDE.md: packages/common/infra-config

Loaded when working in `packages/common/infra-config`. The repo-wide rules are in the root [CLAUDE.md](../../../CLAUDE.md); how the stacks use this config is in `packages/infra/CLAUDE.md`.

Per-stage deployment config (credentials, region, which security features are on), and the one definition of the local portals' ports and origins (`local-portals`, imported per module as `@discava/common-infra-config/local-portals` by the stacks, constructs, local dev, e2e and the portals' vite configs).

Stages are defined in `src/stages.config.ts`; adding a stage means editing that file only.
