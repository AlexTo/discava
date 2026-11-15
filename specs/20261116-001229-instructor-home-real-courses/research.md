# Research: Real Courses on the Instructor Home Page

## R1. Data source

- **Decision**: Use `course.listByInstructor` from core-api, as My Courses does, with `instructorId` from the signed-in user's `sub`.
- **Rationale**: It already returns the instructor's courses newest-updated first via the `byInstructor` index, and My Courses proves it works against local and deployed stages. No new procedure needed.
- **Alternatives**: A new "home summary" procedure (rejected: more surface, nothing the list can't give); reading from the search index (rejected: eventual consistency, wrong tool).

## R2. Hiding archived courses

- **Decision**: Fetch the list, filter out `archived` in the portal, and show the first 6.
- **Rationale**: The procedure has no status filter, and adding one for six cards isn't worth an API change before launch. The list is capped at 100 per request like My Courses.
- **Alternatives**: Add a `status` filter to the API (rejected for now); show archived too (rejected in clarification: they crowd the slots).
- **Known limit**: an instructor with more than 100 courses whose newest 100 are all archived would see an empty home. Treated as unrealistic and noted, not engineered around.

## R3. Authorization

- **Decision**: No change. The portal passes the caller's own `sub` as `instructorId`, matching My Courses.
- **Finding**: `listCoursesByInstructor` takes `instructorId` as an input and does not check it equals the caller. That is existing behaviour shared with My Courses, outside this feature, and is recorded as a follow-up.
- **Rationale**: This feature adds no new exposure.

## R4. Opening a listed course

- **Decision**: Link each card to `/my-courses/$courseId`, the route My Courses uses.
- **Rationale**: Every listed course comes from the caller's own memberships, so the editor's instructor check passes (SC-001).

## R5. New course appears without reload (FR-009)

- **Decision**: Creating a course already navigates to its editor. Home reads the list through TanStack Query with the app's default staleness, so returning to Home refetches. The scenario verifies this; no explicit cache invalidation is added unless the test shows it is needed.
- **Alternatives**: Invalidate `listByInstructor` in `CreateCourseDialog` on success (the fallback if the e2e scenario fails).

## R6. Removed sections

- **Decision**: Delete the sample grading queue, upcoming, recent activity, quick-action list (except "Create a course") and the student and to-grade figures, along with their now-unused icons and arrays.
- **Rationale**: Showing invented facts is the bug. They return when assignments grading and activity feeds supply data.
