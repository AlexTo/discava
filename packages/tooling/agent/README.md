# @discava/tooling-agent

The agent and PR tooling the workflows in `.github/workflows/` run.

| Target | What it does |
| --- | --- |
| `agent-issue` | Picks the next issue for the agent |
| `validate-tasks` | Checks every spec's `tasks.md` against the format the Agent Issues workflow reads |
| `archive-specs` | Archives finished specs |
| `agent-ci-status` | Posts the agent CI status |
| `agent-review-status` | Posts the agent review status |
| `ui-screenshots` | Checks the pull request's UI screenshots |
| `screenshots-comment` | Comments the screenshots on the pull request |
| `entity-writers` | Regenerates core-table's `entity-writers.json` |
| `invariant-coverage` | Checks the core-table invariants cover every writer |

```sh
pnpm nx run @discava/tooling-agent:entity-writers
pnpm nx test @discava/tooling-agent
```
