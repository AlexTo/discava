# CLAUDE.md: packages/tooling/agent

Loaded when working in `packages/tooling/agent`. The repo-wide rules are in the root [CLAUDE.md](../../../CLAUDE.md).

The tooling the agent and PR workflows in `.github/workflows/` run. Each is invoked by an Nx target; `project.json` lists them. The rules of each check are in its folder under `src/`:

- `agent-issues`: `agent-issue` (picks the next issue), `validate-tasks`, `archive-specs`
- `agent-ci`: `agent-ci-status`
- `agent-review`: `agent-review-status`
- `ui-screenshots`: `ui-screenshots`, `screenshots-comment`
- `invariant-coverage`: `entity-writers` and `invariant-coverage` (see `packages/databases/core-table/CLAUDE.md`); `WRITER_PACKAGES` in `src/invariant-coverage/scan.ts` lists the packages it scans

The workflows name these targets, so renaming one means editing `.github/workflows/`, which the agent may not do.
