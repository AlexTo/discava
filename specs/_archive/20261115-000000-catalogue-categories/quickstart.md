# Quickstart: Validating Catalogue Categories, Tags and Richer Filters

Prerequisites: Docker running; `pnpm i`; once, `pnpm --filter @discava/e2e exec playwright install chromium`.

## Automated

```sh
pnpm nx run-many --target test --projects=@discava/core-table,@discava/core-api,@discava/instructor-api,@discava/admin-api,@discava/search,@discava/events,@discava/student-portal,@discava/instructor-portal,@discava/admin-portal
pnpm nx e2e @discava/e2e        # includes the facet-count search scenario, category.e2e.ts and the same-name race
pnpm build                       # synth, checkov and the stack resource count (AdminApi is a new stack)
```

The e2e scenarios make their own users and uniquely named data, and end with the core-table invariant check.

## By hand (local stack)

1. `pnpm dev`, then `pnpm nx run @discava/common-scripts:seed-categories` to load the starting categories.
2. Sign in as Carol (admin) in the admin portal. Add a category, rename it, archive it; see the course count column.
3. Sign in as Alice (instructor) in the instructor portal. On a course set category, tags (try a ninth tag), level, language and duration; publish it.
4. In the student portal (signed out), open the catalogue. Expect category chips with counts, a filter panel with counts, and the course under the values you set.
5. Select a level, then a second level in the same group (results widen), then a language (results narrow). Reload: the filters remain.
6. Open `/category/<slug>`: only that category's published courses, facets counted within it. Open a made-up slug and an archived category's slug: the not-found and no-longer-available pages.
7. Change the course's category as Alice; within a minute the old and new category pages reflect it.

## Rolling out to an existing stage

After deploy the new mapping fields exist but older documents lack them. Invoke the re-index Lambda from #273 once (`aws lambda invoke --function-name <name> out.json`, or its Nx target) and check that published courses appear under the facets.
