# CLAUDE.md: packages/common/constructs

Loaded when working in `packages/common/constructs`. The repo-wide rules are in the root [CLAUDE.md](../../../CLAUDE.md); how the stacks compose these constructs is in `packages/infra/CLAUDE.md`.

All CDK constructs live here. A construct owns one component's own resources (e.g. an API with its handlers and WAF) and exposes `grant*`/`restrictCorsTo`-style helpers; `lambda-functions/` holds the generator-owned bare `Function` wrappers.
