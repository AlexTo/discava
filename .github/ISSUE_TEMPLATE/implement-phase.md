---
name: Implement a spec phase
about: Hand one phase of a feature's tasks.md to the implementing agent
title: "feat(<scope>): <phase or story>"
labels: []
---

<!--
Fill this in, then add the `openhands` label. The label is the go signal: the
agent picks the issue up on its next poll (about 15 minutes).
Create one issue per phase or story, and the next one only after the previous
pull request has merged.
-->

## Spec

- Spec folder: `specs/<timestamp>-<name>/` (read `spec.md`, `plan.md`, `tasks.md`, `data-model.md`, `contracts/`)
- Parent issue: #<number>

## Scope

Tasks `T0xx` to `T0yy` of `tasks.md` (<phase or story>). Do not start tasks outside this range.

## Instructions for the agent

- Read `CLAUDE.md`, `.specify/memory/constitution.md` and the spec folder first.
- Work through the scope in order, writing each story's tests first. Tick each task in `tasks.md` in the same commit that completes it.
- Do not use `pnpm dev`, Docker or the e2e runner locally. Run unit and component tests (once, not in watch mode), `pnpm lint`, typecheck and `pnpm build` on what you changed. E2E and concurrency tests run on PR CI: write them, then read CI's result.
- Skip tasks marked **(human)** and list them in the PR description for the reviewer.
- Use Conventional Commits for every commit. The PR title is a Conventional Commit too, for example `feat(assignments): submit work to an upload assignment`, not `[#n] ...`.
- In the PR description write `Refs #<parent>`. Never use `Closes` or `Fixes` against the parent issue; closing this issue is fine.
- Never weaken a test to make it pass, never edit `.github/workflows/`, never merge, and don't touch AWS credentials.
- If you are blocked, comment on this issue with what you tried and stop.
