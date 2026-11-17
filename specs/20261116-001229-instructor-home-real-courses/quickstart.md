# Quickstart: Validating the Instructor Home Page

## Automated (what an agent runs)

```sh
pnpm nx run @discava/instructor-portal:test -- --run -index.test.tsx
pnpm nx run @discava/instructor-portal:lint
pnpm nx run @discava/instructor-portal:build
```

Pull request CI runs the e2e scenario `packages/e2e/src/scenarios/instructor-home.e2e.ts`.

## Manual (human, before merge)

Needs Docker and `pnpm dev`; sign in on the local OIDC page.

1. As an instructor with courses: the home page lists exactly the courses My Courses shows, minus archived ones, newest first, at most 6. Open each; none shows a permission error.
2. As "Someone else" with no courses: the empty state with "Create a course" shows, and no sample names, titles or counts appear anywhere.
3. Create a course from the home page, return to Home: the course is listed.
4. Block the course list request in dev tools, reload: an error with Retry shows (not the empty state). Unblock, press Retry: courses appear.
5. Save screenshots of each step to `tmp/screenshots/pr-<number>/`.
