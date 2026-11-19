# Specs

Each folder here is one feature, named `<yyyymmdd-hhmmss>-<feature>`. It holds the feature's `spec.md`, `plan.md`, `tasks.md` and the documents they point to (`data-model.md`, `contracts/`, `research.md`, `quickstart.md`, `checklists/`). The Agent Issues workflow reads each `tasks.md` and opens issues for the tasks that are left.

Design pages in `docs/src/content/docs/en/design/` describe how a feature works today. A page and its spec link to each other: the page has a "Spec" link and `spec.md` has a "Design page" line.

## `_archive/`

`_archive/` holds finished specs, kept as history. The agent-issue tooling skips it: a pull request touching it never opens an issue, and `validate-tasks` doesn't check its `tasks.md` files against the format, only that every task in them is ticked. Treat what is in it as done, not as live work.

## When to archive

A spec is archived once every task in its `tasks.md` is ticked, the **(human)** ones too. The **Archive Specs** workflow (`.github/workflows/archive-specs.yml`) does it: whenever a live `tasks.md` changes on `main`, it opens a pull request, on branch `archive-spec/<folder>`, that moves each finished spec with `git mv specs/<folder> specs/_archive/<folder>` (keeping the name) and fixes the links to and from it, the design page's "Spec" link included. It skips a spec that still has an open agent issue. Review the pull request like any other, then merge it. Close it unmerged to keep the spec live: the workflow won't open another for that spec. To archive by hand, do the same move and link fixes yourself. Never archive a spec that still has an unticked task or an open agent issue.
