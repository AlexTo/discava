# Specs

Each folder here is one feature, named `<yyyymmdd-hhmmss>-<feature>`. It holds the feature's `spec.md`, `plan.md`, `tasks.md` and the documents they point to (`data-model.md`, `contracts/`, `research.md`, `quickstart.md`, `checklists/`). The Agent Issues workflow reads each `tasks.md` and opens issues for the tasks that are left.

Design pages in `docs/src/content/docs/en/design/` describe how a feature works today. A page and its spec link to each other: the page has a "Spec" link and `spec.md` has a "Design page" line.

## `_archive/`

`_archive/` holds finished specs, kept as history. The agent-issue tooling skips it: `validate-tasks` does not check its `tasks.md` files and a pull request touching it never opens an issue. Treat what is in it as done, not as live work.

## When to archive

Archive a spec when its `tasks.md` has no unticked task other than ones marked **(human)**. Move the whole folder with `git mv specs/<folder> specs/_archive/<folder>` (keep the name), then fix links that name the old path, including the design page's "Spec" link. Never archive a spec that still has an open agent issue.
